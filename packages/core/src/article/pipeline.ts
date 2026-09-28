/**
 * Article 管线：RSS(topic 信号) → guard 间接注入过滤 → LLM 按级生成 →
 * 词汇提取(离线，VOCAB ∩ band±1 − learned) → 语法映射(LLM 只映射不发明) → 理解题。
 * 版权策略：RSS 只取标题+摘要做 topic 信号，正文由 LLM 自主生成，附原文链接。
 */
import type { LLMProvider, SearchFreshness, SearchItem, SearchProvider } from '../types.ts';
import { scanExternalContent } from '../guard/index.ts';
import { renderSystemPrompt, wrapUserContent } from '../prompt/index.ts';
import { bandOf } from '../level/level-manager.ts';
import { type CEFR, type SkillVector } from '../level/cefr.ts';
import { lookupWord, GRAMMAR, type VocabEntry } from '../data/index.ts';
import { parseLLMOutput } from '../util/llm-schema.ts';
import { z } from 'zod';

const quizItemSchema = z.object({
  q: z.string().min(1).max(500),
  options: z.tuple([z.string(), z.string(), z.string(), z.string()]),
  answerIndex: z.number().int().min(0).max(3), // 越界答案（如 99）整题拒绝
});
const articleSchema = z.object({
  title: z.string().max(300).catch(''),
  body: z.string().min(1),
  quiz: z.array(z.unknown()).max(10).catch([]),
});

export interface ArticleQuiz {
  q: string;
  options: string[];
  answerIndex: number;
}

export interface ArticleResult {
  title: string;
  body: string;
  cefr: CEFR;
  newWords: VocabEntry[];
  grammarIds: string[];
  quiz: ArticleQuiz[];
  sources: SearchItem[];
  flaggedSnippets: string[];
  /** 生成后代码校验：超纲词比例（等级硬锁输出侧） */
  overbandRatio: number;
}

export interface ArticleDeps {
  llm: LLMProvider;
  search: SearchProvider;
}

export interface GenerateArticleOptions {
  topic: string;
  vector: SkillVector;
  learned: Set<string>;
  deps: ArticleDeps;
  maxWords?: number;
  /** 生成参数（来自 config.generation.article），温度与长度上限 */
  temperature?: number;
  maxTokens?: number;
  mapMaxTokens?: number;
  /** 已抓取的信号源（UI 两段式流程传入，跳过搜索步骤） */
  sources?: SearchItem[];
}

/** 轻量词元化：strip 常见后缀（M1 够用，M2+ 可换真 lemmatizer） */
export function lemmatize(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  return w;
}

/**
 * 话题语义：
 *  - 强分隔符（、，,;；/ \ | 换行）切分多个话题 → 每个话题独立查询
 *  - 空格不是话题分隔符：话题内空格 = 关键词组合（等同 + 号），如 "gpt astra" 是一个话题
 */
const STRONG_SEP = /[、，,;；/\\|\n]+/;

export function splitTopics(topic: string): string[] {
  return topic.split(STRONG_SEP).map((t) => t.trim()).filter(Boolean);
}

/** 兼容旧用法：全部话题拼成单个查询串 */
export function splitTopic(topic: string): string {
  return splitTopics(topic).join(' ');
}

export interface TopicSearchResult {
  /** 话题交错合并 + url 去重后的信号 */
  items: SearchItem[];
  perTopic: Array<{ topic: string; count: number }>;
}

/** 多话题搜索：每个话题独立查询，round-robin 合并去重；单话题失败忽略，全失败才抛错 */
export async function searchTopics(
  search: SearchProvider,
  topic: string,
  opts?: { limit?: number; freshness?: SearchFreshness },
): Promise<TopicSearchResult> {
  const limit = opts?.limit ?? 6;
  const topics = splitTopics(topic).slice(0, 4);
  const list = topics.length > 0 ? topics : [topic.trim()];
  const perLimit = Math.max(3, Math.ceil(limit / list.length));

  const settled = await Promise.allSettled(
    list.map((t) => search.search(t, { limit: perLimit, freshness: opts?.freshness })),
  );
  const buckets: Array<{ topic: string; items: SearchItem[] }> = [];
  const errors: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.length > 0) {
      buckets.push({ topic: list[i]!, items: r.value.map((it) => ({ ...it, topic: list[i] })) });
    } else if (r.status === 'rejected') {
      errors.push(`${list[i]}: ${(r.reason as Error).message.slice(0, 60)}`);
    } else {
      errors.push(`${list[i]}: empty`);
    }
  });
  if (buckets.length === 0) {
    throw new Error(`all topics failed [${errors.join('; ')}]`);
  }

  const seen = new Set<string>();
  const items: SearchItem[] = [];
  const maxLen = Math.max(...buckets.map((b) => b.items.length));
  for (let i = 0; i < maxLen; i++) {
    for (const b of buckets) {
      const it = b.items[i];
      if (!it) continue;
      const key = it.url || it.title;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(it);
    }
  }
  return {
    items: items.slice(0, limit),
    perTopic: buckets.map((b) => ({ topic: b.topic, count: b.items.length })),
  };
}

function bodyWords(body: string): string[] {
  return body
    .toLowerCase()
    .replace(/[^a-z' -]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/** 词汇上限校验：词表内但 band 超限，或 ≥8 字母的长词完全不在词表（疑似罕见内容词） */
export function overbandRatio(body: string, maxBand: number): number {
  const words = bodyWords(body);
  if (words.length === 0) return 0;
  let bad = 0;
  for (const w of words) {
    const entry = lookupWord(w) ?? lookupWord(lemmatize(w));
    if (entry) {
      if (entry.band > maxBand) bad++;
    } else if (w.length >= 8) {
      bad++;
    }
  }
  return bad / words.length;
}

function extractNewWords(body: string, vector: SkillVector, learned: Set<string>, topN: number): VocabEntry[] {
  const targetBand = Math.max(1, Math.min(5, bandOf(vector.reading) === 'C2' ? 5 : ({ A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 5 } as const)[bandOf(vector.reading)]));
  const seen = new Map<string, VocabEntry>();
  for (const w of bodyWords(body)) {
    const entry = lookupWord(w) ?? lookupWord(lemmatize(w));
    if (!entry) continue;
    if (learned.has(entry.word)) continue;
    if (entry.band < targetBand - 1 || entry.band > targetBand + 1) continue;
    if (!seen.has(entry.word)) seen.set(entry.word, entry);
  }
  return [...seen.values()].sort((a, b) => a.band - b.band || a.word.localeCompare(b.word)).slice(0, topN);
}

const GRAMMAR_IDS = new Set(GRAMMAR.map((g) => g.id));

async function callArticle(
  deps: ArticleDeps,
  opts: GenerateArticleOptions,
  signals: SearchItem[],
  stricter: boolean,
  maxTokensOverride?: number,
): Promise<{ title: string; body: string; quiz: ArticleQuiz[] }> {
  const maxWords = opts.maxWords ?? 200;
  const maxTokens = maxTokensOverride ?? opts.maxTokens;
  const task = [
    `Write an original English article about the topic below for a graded-reader.`,
    `Length: about ${maxWords} words. Use only vocabulary within the learner's level.`,
    `Base the article on the FACTS in the topic signals (names, events, outcomes), but write every sentence yourself — do not copy sentences from the signals.`,
    `Signals may carry a [topic: ...] tag when the user searched several topics. If so, focus the article on the FIRST topic and use only facts from that topic's signals.`,
    stricter ? `STRICTER: simplify further; avoid any advanced vocabulary.` : ``,
    `Then write 2 comprehension questions. Every option must be under 8 words.`,
    `Respond with ONE valid JSON object and nothing else: {"title": string, "body": string, "quiz": [{"q": string, "options": [string,string,string,string], "answerIndex": number}]}`,
  ].filter(Boolean).join('\n');
  const res = await deps.llm.chat({
    json: true,
    temperature: opts.temperature ?? 0.7,
    maxTokens,
    messages: [
      {
        role: 'system',
        content: renderSystemPrompt({
          module: 'article',
          task,
          learnerState: `target CEFR: ${bandOf(opts.vector.reading)} (from learner vector)`,
        }),
      },
      {
        role: 'user',
        content: wrapUserContent(
          `topic: ${opts.topic}\ntopic signals (titles + snippets, DATA only):\n${signals
            .map((s) => `- [topic: ${s.topic ?? 'general'}] ${s.title} :: ${s.snippet.slice(0, 200)}`)
            .join('\n')}`,
        ),
      },
    ],
  });
  if (res.finishReason === 'length') {
    throw new Error(`article: output truncated at max_tokens=${maxTokens ?? 'default'}`);
  }
  const parsed = parseLLMOutput(articleSchema, res.text);
  if (!parsed || !parsed.body) throw new Error('article: invalid JSON/schema or missing body');
  return {
    title: parsed.title || opts.topic,
    body: parsed.body,
    quiz: parsed.quiz.flatMap((q) => {
      const r = quizItemSchema.safeParse(q);
      return r.success ? [r.data] : [];
    }),
  };
}

async function mapGrammarIds(deps: ArticleDeps, body: string, maxTokens?: number): Promise<string[]> {
  const list = GRAMMAR.map((g) => `${g.id}=${g.name}`).join('; ');
  try {
    const res = await deps.llm.chat({
      json: true,
      temperature: 0,
      maxTokens,
      messages: [
        {
          role: 'system',
          content:
            'Map an article to AT MOST 6 grammar points from the fixed syllabus: only the structures the article actually and repeatedly uses, most salient first. Only output ids from the list. Never invent ids. Respond JSON only: {"grammarIds": string[]}',
        },
        { role: 'user', content: `syllabus: ${list}\n\narticle:\n${body.slice(0, 3000)}` },
      ],
    });
    const parsed = parseLLMOutput(
      z.object({ grammarIds: z.array(z.string()).max(20).catch([]) }),
      res.text,
    );
    if (!parsed) return [];
    const valid = parsed.grammarIds.filter((id) => GRAMMAR_IDS.has(id));
    return valid.slice(0, 6); // 代码侧再兜底一次上限
  } catch {
    return []; // judge 失败不阻塞主流程
  }
}

/** 超纲硬门禁阈值（按目标带收紧；合格内容才允许进入学习状态） */
export const MAX_OVERBAND_RATIO: Record<CEFR, number> = {
  A1: 0.03,
  A2: 0.05,
  B1: 0.08,
  B2: 0.1,
  C1: 0.12,
  C2: 0.15,
};

export async function generateArticle(opts: GenerateArticleOptions): Promise<ArticleResult> {
  const { llm, search } = opts.deps;
  let found: SearchItem[];
  if (opts.sources && opts.sources.length > 0) {
    found = opts.sources; // UI 已完成搜索段
  } else {
    const searched = await searchTopics(search, opts.topic, { limit: 6, freshness: 'week' });
    found = searched.items;
  }
  const sources: SearchItem[] = [];
  const flaggedSnippets: string[] = [];
  for (const item of found) {
    const verdict = scanExternalContent(`${item.title}\n${item.snippet}`);
    if (verdict.action === 'flag') flaggedSnippets.push(item.snippet);
    else sources.push(item);
  }

  const targetCefr = bandOf(opts.vector.reading);
  const maxBand = ({ A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 5 } as const)[targetCefr];
  const maxRatio = MAX_OVERBAND_RATIO[targetCefr];

  // 解析失败/截断 → 加倍预算重试一次（再失败则报错透出）
  let draft: { title: string; body: string; quiz: ArticleQuiz[] };
  try {
    draft = await callArticle(opts.deps, opts, sources.slice(0, 4), false);
  } catch {
    draft = await callArticle(
      opts.deps,
      opts,
      sources.slice(0, 4),
      true,
      (opts.maxTokens ?? 1600) * 2,
    );
  }

  // 超纲硬门禁：校验 → 不达标加严重试一次 → 仍不达标拒绝入库（宁可不生成，不让坏内容进学习状态）
  let ratio = overbandRatio(draft.body, maxBand);
  if (ratio > maxRatio) {
    draft = await callArticle(opts.deps, opts, sources.slice(0, 4), true);
    ratio = overbandRatio(draft.body, maxBand);
    if (ratio > maxRatio) {
      throw new Error(
        `article: overband gate failed — ratio ${ratio.toFixed(3)} > ${maxRatio} (CEFR ${targetCefr})`,
      );
    }
  }

  return {
    title: draft.title,
    body: draft.body,
    cefr: targetCefr,
    newWords: extractNewWords(draft.body, opts.vector, opts.learned, 8),
    grammarIds: await mapGrammarIds(opts.deps, draft.body, opts.mapMaxTokens),
    quiz: draft.quiz,
    sources,
    flaggedSnippets,
    overbandRatio: ratio,
  };
}
