import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { ensureLearner, getLlm, getDb, loadSkillStates, applySignal, getGenerationParams } from '@/lib/server';
import { createProviders } from '@openlango/providers';
import {
  articles,
  vocabStates,
  grammarStates,
  GRAMMAR,
  generateArticle,
  searchTopics,
  scanExternalContent,
  emptySrsFields,
  type ArticleQuiz,
  type ArticleResult,
  type SearchItem,
  type TopicSearchResult,
} from '@openlango/core';

function getSearch() {
  return createProviders({ search: { driver: 'rss' } }).search ?? null;
}

export async function POST(req: Request) {
  const body = (await req.json()) as
    | { action: 'search'; topic: string; freshness?: 'day' | 'week' }
    | { action: 'compose'; topic: string; sources: SearchItem[] }
    | { action: 'generate'; topic: string }
    | { action: 'answer'; articleId: string; answers: number[] };
  const learner = await ensureLearner();
  const db = getDb();

  // 第一段：只抓热点（不需要 LLM，秒级返回）
  if (body.action === 'search') {
    const search = getSearch();
    if (!search) return NextResponse.json({ error: '搜索 provider 未配置' }, { status: 503 });
    const freshness = body.freshness === 'day' ? 'day' : 'week';
    let result: TopicSearchResult;
    try {
      result = await searchTopics(search, body.topic, { limit: 6, freshness });
    } catch (err) {
      return NextResponse.json({ error: `热点抓取失败：${(err as Error).message.slice(0, 200)}（检查网络或换 config 中 search 引擎）` }, { status: 502 });
    }
    const sources: SearchItem[] = [];
    const flaggedSnippets: string[] = [];
    for (const item of result.items) {
      const verdict = scanExternalContent(`${item.title}\n${item.snippet}`);
      if (verdict.action === 'flag') flaggedSnippets.push(item.snippet);
      else sources.push(item);
    }
    return NextResponse.json({ sources, flaggedSnippets, perTopic: result.perTopic });
  }

  if (body.action === 'generate' || body.action === 'compose') {
    const llm = getLlm();
    const search = getSearch();
    if (!llm) {
      return NextResponse.json({ error: 'LLM 未配置：复制 .env.example 为 .env 填入 key 后重启，或在“设置与状态”页测试连接' }, { status: 503 });
    }
    if (!search) {
      return NextResponse.json({ error: '搜索 provider 未配置' }, { status: 503 });
    }
    const vectorState = await loadSkillStates(learner.id);
    const vector = {
      reading: vectorState.reading.theta,
      listening: vectorState.listening.theta,
      speaking: vectorState.speaking.theta,
      vocabulary: vectorState.vocabulary.theta,
      grammar: vectorState.grammar.theta,
    };
    const learnedRows = await db.select().from(vocabStates).where(eq(vocabStates.learnerId, learner.id));
    const learned = new Set(learnedRows.map((r) => r.word));
    const gen = getGenerationParams('article');
    const opts = {
      topic: body.topic,
      vector,
      learned,
      deps: { llm, search },
      temperature: gen.temperature,
      maxTokens: gen.maxTokens,
      mapMaxTokens: getGenerationParams('map').maxTokens,
      ...(body.action === 'compose' ? { sources: body.sources } : {}),
    };
    let out: ArticleResult;
    try {
      out = await generateArticle(opts);
    } catch (err) {
      return NextResponse.json({ error: `LLM 调用失败：${(err as Error).message.slice(0, 300)}` }, { status: 502 });
    }

    const articleId = crypto.randomUUID();
    await db.insert(articles).values({
      id: articleId,
      learnerId: learner.id,
      topic: body.topic,
      title: out.title,
      cefr: out.cefr,
      body: out.body,
      vocabJson: JSON.stringify(out.newWords),
      grammarJson: JSON.stringify(out.grammarIds),
      sourcesJson: JSON.stringify(out.sources),
      quizJson: JSON.stringify(out.quiz),
      flaggedJson: JSON.stringify(out.flaggedSnippets),
      overbandRatio: out.overbandRatio,
    });

    // 新词自动进入学习集（FSRS 新卡，立即到期）
    for (const w of out.newWords) {
      const f = emptySrsFields();
      await db.insert(vocabStates).values({
        id: crypto.randomUUID(),
        learnerId: learner.id,
        word: w.word,
        cefr: w.cefr,
        band: w.band,
        source: w.source,
        state: 'learning',
        fsrsState: f.state,
        stability: f.stability,
        difficulty: f.difficulty,
        reps: f.reps,
        lapses: f.lapses,
        dueAt: f.dueAt,
      }).onConflictDoNothing();
    }
    // 语法映射点进入曝光态
    for (const gid of out.grammarIds) {
      const existing = await db
        .select()
        .from(grammarStates)
        .where(eq(grammarStates.grammarId, gid));
      if (!existing.some((r) => r.learnerId === learner.id)) {
        const f = emptySrsFields();
        await db.insert(grammarStates).values({
          id: crypto.randomUUID(),
          learnerId: learner.id,
          grammarId: gid,
          state: 'exposure',
          fsrsState: f.state,
          stability: f.stability,
          difficulty: f.difficulty,
          reps: 0,
          lapses: 0,
          dueAt: f.dueAt,
        });
      }
    }

    return NextResponse.json({
      id: articleId,
      title: out.title,
      body: out.body,
      cefr: out.cefr,
      newWords: out.newWords,
      grammarIds: out.grammarIds,
      grammarPoints: out.grammarIds.map((gid) => {
        const g = GRAMMAR.find((x) => x.id === gid)!;
        return { id: gid, name: g.name, zh: g.zh };
      }),
      quiz: out.quiz,
      sources: out.sources,
      flaggedSnippets: out.flaggedSnippets,
    });
  }

  // answer：理解题评分 → reading/vocabulary 信号
  const rows = await db.select().from(articles).where(eq(articles.id, body.articleId));
  const article = rows[0];
  if (!article?.quizJson) return NextResponse.json({ error: 'article not found' }, { status: 404 });
  const quiz = JSON.parse(article.quizJson) as ArticleQuiz[];
  let correctCount = 0;
  quiz.forEach((q, i) => {
    if (body.answers[i] === q.answerIndex) correctCount++;
  });
  const p = quiz.length > 0 ? 30 + (70 * correctCount) / quiz.length : 50;
  await applySignal(learner.id, 'reading', p);
  await applySignal(learner.id, 'vocabulary', p);
  return NextResponse.json({ total: quiz.length, correctCount });
}

export const dynamic = 'force-dynamic';
