/**
 * 练测生成（离线、确定性、只映射 grammar.json 不发明）。
 * 语法钻练两类：cloze 补全 / 结构识别；与 placement 共用生成器。
 */
import { mulberry32, makeClozeItem, makeIdentifyItem, type PlacementItem } from '../level/placement.ts';
import { GRAMMAR, type GrammarItem } from '../data/index.ts';

export type DrillItem = PlacementItem;

function hashCode(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeDrill(grammarId: string, nonce = 0): DrillItem {
  const g = GRAMMAR.find((x) => x.id === grammarId);
  if (!g) throw new Error(`unknown grammarId: ${grammarId}`);
  const rng = mulberry32(hashCode(grammarId) ^ nonce);
  const idx = Math.floor(rng() * 1e6);
  return rng() < 0.5 ? makeClozeItem(g, rng, idx) : makeIdentifyItem(g, rng, idx);
}

/** 弱项优先排程：按（未掌握 > 低等级 > 长期未练）给 grammar 排序权重 */
export function prioritizeGrammar(
  states: Array<{ grammarId: string; state: string; dueAt: Date | null }>,
): string[] {
  const order = new Map(['unknown', 'exposure', 'practice', 'test', 'mastered'].map((s, i) => [s, i]));
  return [...states]
    .sort((a, b) => {
      const sa = order.get(a.state) ?? 9;
      const sb = order.get(b.state) ?? 9;
      if (sa !== sb) return sa - sb;
      const da = a.dueAt?.getTime() ?? Infinity;
      const db = b.dueAt?.getTime() ?? Infinity;
      return da - db;
    })
    .map((s) => s.grammarId);
}

export type { GrammarItem };
