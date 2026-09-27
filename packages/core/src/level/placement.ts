/**
 * Placement 定级引擎（纯逻辑，零模型依赖）。
 * - ELO 内核自适应抽题：expected=1/(1+10^((b-θ)/8))，K 随题数衰减（16→6）
 * - 题库离线生成自 grammar.json（cloze 补全 + 结构识别两类，难度=所在 CEFR 带中点）
 * - 文字定级只能测 reading/grammar/vocabulary；listening/speaking 以 reading 锚定低估初值
 *   （口语通常滞后书面），由 coach/article 使用中的信号修正，confidence 标低。
 */
import { cefrToThetaMidpoint, clampTheta } from './cefr.ts';
import { GRAMMAR, type GrammarItem } from '../data/index.ts';

export type RNG = () => number;

/** 确定性 RNG（mulberry32），测试可复现 */
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type PlacementItemKind = 'cloze' | 'identify';

export interface PlacementItem {
  id: string;
  kind: PlacementItemKind;
  difficulty: number;
  prompt: string;
  options: string[];
  answer: number;
  grammarId: string;
}

export interface PlacementState {
  theta: number;
  count: number;
  askedIds: string[];
  lastDelta: number;
  seed: number;
}

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2'] as const;
const SCALE = 8; // θ 值域 0-100 对应的 logistic 尺度

export class PlacementEngine {
  theta: number;
  count = 0;
  askedIds: string[] = [];
  lastDelta = 0;
  readonly seed: number;
  /** 文字定级上限题数 */
  static readonly MAX_ITEMS = 8;

  constructor(seed = Math.floor(Math.random() * 2 ** 31), theta = 50) {
    this.seed = seed;
    this.theta = theta;
  }

  record(difficulty: number, correct: boolean): void {
    const expected = 1 / (1 + 10 ** ((difficulty - this.theta) / SCALE));
    const k = Math.max(6, 16 - this.count * 1.5);
    const prev = this.theta;
    this.theta = clampTheta(this.theta + k * ((correct ? 1 : 0) - expected));
    this.lastDelta = this.theta - prev;
    this.count++;
  }

  get finished(): boolean {
    if (this.count >= PlacementEngine.MAX_ITEMS) return true;
    return this.count >= 5 && Math.abs(this.lastDelta) < 2;
  }

  /** 自适应下一题目标难度：θ 附近抖动 ±8 */
  nextDifficulty(rng: RNG): number {
    return clampTheta(this.theta + (rng() * 16 - 8));
  }

  /** 五维初值：grammar 取实测，vocabulary/reading 同锚，listening/speaking 低估锚定 */
  result(): { vector: Record<string, number>; confidence: Record<string, number> } {
    const g = this.theta;
    const conf = Math.min(0.9, 0.35 + this.count * 0.07);
    return {
      vector: {
        grammar: g,
        reading: g,
        vocabulary: g,
        listening: Math.max(0, g - 8),
        speaking: Math.max(0, g - 12),
      },
      confidence: {
        grammar: conf,
        reading: conf * 0.9,
        vocabulary: conf * 0.7,
        listening: conf * 0.4,
        speaking: conf * 0.4,
      },
    };
  }

  serialize(): PlacementState {
    return { theta: this.theta, count: this.count, askedIds: [...this.askedIds], lastDelta: this.lastDelta, seed: this.seed };
  }

  static from(s: PlacementState): PlacementEngine {
    const e = new PlacementEngine(s.seed, s.theta);
    e.count = s.count;
    e.askedIds = [...s.askedIds];
    e.lastDelta = s.lastDelta;
    return e;
  }
}

function grammarDifficulty(g: GrammarItem): number {
  return cefrToThetaMidpoint(g.cefr as (typeof CEFR_ORDER)[number]);
}

function pickGrammarNear(target: number, rng: RNG, exclude: Set<string>): GrammarItem {
  const pool = GRAMMAR.filter((g) => !exclude.has(g.id));
  const sorted = [...(pool.length > 0 ? pool : GRAMMAR)].sort(
    (a, b) => Math.abs(grammarDifficulty(a) - target) - Math.abs(grammarDifficulty(b) - target),
  );
  const top = sorted.slice(0, Math.min(4, sorted.length));
  return top[Math.floor(rng() * top.length)]!;
}

function tokenize(sentence: string): string[] {
  return sentence.replace(/[.,!?;:]/g, '').split(/\s+/);
}

/** 补全题：例句挖最长词，干扰项取同 CEFR 其他例句中长度相近的词 */
export function makeClozeItem(g: GrammarItem, rng: RNG, idx: number): PlacementItem {
  const sentence = g.examples[Math.floor(rng() * g.examples.length)]!;
  const tokens = tokenize(sentence);
  const candidates = tokens
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.length >= 4 && /^[a-zA-Z']+$/.test(t));
  const chosen = candidates.length > 0
    ? candidates[Math.floor(rng() * candidates.length)]!
    : { t: tokens[0]!, i: 0 };
  const promptTokens = sentence.split(/\s+/);
  promptTokens[chosen.i] = '___';
  const distractors: string[] = [];
  const candidatesWords = GRAMMAR.filter((o) => o.id !== g.id && o.cefr === g.cefr)
    .flatMap((o) => tokenize(o.examples[0]!))
    .filter((w) => w.length >= 4 && w.toLowerCase() !== chosen.t.toLowerCase());
  while (distractors.length < 3 && candidatesWords.length > 0) {
    const w = candidatesWords.splice(Math.floor(rng() * candidatesWords.length), 1)[0]!;
    if (!distractors.includes(w)) distractors.push(w);
  }
  while (distractors.length < 3) distractors.push(`${chosen.t}s`);
  const options = [chosen.t, ...distractors];
  const answer = Math.floor(rng() * options.length);
  [options[0], options[answer]] = [options[answer]!, options[0]!];
  return {
    id: `cloze-${g.id}-${idx}`,
    kind: 'cloze',
    difficulty: grammarDifficulty(g),
    prompt: promptTokens.join(' '),
    options,
    answer,
    grammarId: g.id,
  };
}

/** 结构识别题：哪个句子用了该语法点 */
export function makeIdentifyItem(g: GrammarItem, rng: RNG, idx: number): PlacementItem {
  const others = GRAMMAR.filter((o) => o.id !== g.id && o.cefr === g.cefr);
  const opts: string[] = [g.examples[0]!];
  while (opts.length < 4 && others.length > 0) {
    const o = others.splice(Math.floor(rng() * others.length), 1)[0]!;
    const ex = o.examples[Math.floor(rng() * o.examples.length)]!;
    if (!opts.includes(ex)) opts.push(ex);
  }
  const answer = Math.floor(rng() * opts.length);
  [opts[0], opts[answer]] = [opts[answer]!, opts[0]!];
  return {
    id: `identify-${g.id}-${idx}`,
    kind: 'identify',
    difficulty: grammarDifficulty(g),
    prompt: `Which sentence uses: ${g.name} (${g.zh})?`,
    options: opts,
    answer,
    grammarId: g.id,
  };
}

export function nextPlacementItem(engine: PlacementEngine, state: PlacementState, rng: RNG): PlacementItem {
  const target = engine.nextDifficulty(rng);
  const exclude = new Set(state.askedIds);
  const g = pickGrammarNear(target, rng, exclude);
  const item = rng() < 0.5
    ? makeClozeItem(g, rng, state.count)
    : makeIdentifyItem(g, rng, state.count);
  return item;
}
