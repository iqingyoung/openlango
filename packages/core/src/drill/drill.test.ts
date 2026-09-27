import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeDrill, prioritizeGrammar } from './drill.ts';
import { GRAMMAR } from '../data/index.ts';

test('drill 确定性：同 id 同 nonce 同题', () => {
  const a = makeDrill('g062', 1);
  const b = makeDrill('g062', 1);
  assert.deepEqual(a, b);
});

test('drill 覆盖各等级且结构合法', () => {
  for (const g of [GRAMMAR[0]!, GRAMMAR[40]!, GRAMMAR[101]!]) {
    const d = makeDrill(g.id, 3);
    assert.equal(d.options.length, 4);
    assert.equal(new Set(d.options).size, 4);
    assert.ok(d.answer >= 0 && d.answer < 4);
    assert.equal(d.grammarId, g.id);
  }
});

test('未知 grammarId 报错（只映射不发明红线）', () => {
  assert.throws(() => makeDrill('g999'), /unknown grammarId/);
});

test('弱项优先排序：unknown 在前 mastered 在后', () => {
  const out = prioritizeGrammar([
    { grammarId: 'g005', state: 'mastered', dueAt: new Date('2026-01-01') },
    { grammarId: 'g002', state: 'practice', dueAt: new Date('2026-01-05') },
    { grammarId: 'g001', state: 'unknown', dueAt: null },
  ]);
  assert.deepEqual(out, ['g001', 'g002', 'g005']);
});
