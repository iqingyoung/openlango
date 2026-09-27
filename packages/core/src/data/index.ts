/**
 * 语义数据加载（一次性整理入库，运行时 LLM 只映射不发明）。
 * - vocab.json：NGSL 1.2（CC BY-SA 4.0）主干 + Oxford 5000（OALD 词表抓取）等级交叉
 * - grammar.json：A1-B2 核心语法点，分级归属取公开大纲共识，例句原创
 * 出处字段图例见 docs/semantic-data-review.md。
 */
import vocabJson from './vocab.json';
import grammarJson from './grammar.json';
import type { CEFR } from '../level/cefr.ts';

export interface VocabEntry {
  word: string;
  cefr: CEFR;
  band: number; // 1=A1 档 … 5=C1 档（NGSL 频段或 Oxford 等级折算）
  source: string;
}

export interface GrammarItem {
  id: string;
  name: string;
  zh: string;
  cefr: CEFR;
  formula: string;
  examples: string[];
  source: string;
}

export const VOCAB = vocabJson as VocabEntry[];
export const GRAMMAR = grammarJson as GrammarItem[];

const VOCAB_INDEX = new Map(VOCAB.map((v) => [v.word, v]));

export function lookupWord(word: string): VocabEntry | undefined {
  return VOCAB_INDEX.get(word.trim().toLowerCase());
}

/** 语法清单按等级过滤（练-测调度用） */
export function grammarByCefr(cefr: CEFR): GrammarItem[] {
  return GRAMMAR.filter((g) => g.cefr === cefr);
}
