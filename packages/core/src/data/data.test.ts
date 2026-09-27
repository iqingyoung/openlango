import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRAMMAR, VOCAB, grammarByCefr, lookupWord } from './index.ts';

test('vocab 规模与结构', () => {
  assert.ok(VOCAB.length > 5000, `vocab too small: ${VOCAB.length}`);
  const words = new Set(VOCAB.map((v) => v.word));
  assert.equal(words.size, VOCAB.length, 'duplicate words');
  for (const v of VOCAB) {
    assert.ok(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(v.cefr), `bad cefr: ${v.word}`);
    assert.ok(v.band >= 1 && v.band <= 5, `bad band: ${v.word}`);
    assert.ok(v.source.length > 0);
  }
});

test('vocab 抽查', () => {
  const the = lookupWord('the');
  assert.ok(the && the.cefr === 'A1' && the.band === 1);
  assert.ok(lookupWord('website'));
  assert.equal(lookupWord('zzznotaword'), undefined);
});

test('grammar 规模与结构', () => {
  assert.ok(GRAMMAR.length >= 80 && GRAMMAR.length <= 120, `grammar count: ${GRAMMAR.length}`);
  const ids = GRAMMAR.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate grammar ids');
  for (const g of GRAMMAR) {
    assert.ok(['A1', 'A2', 'B1', 'B2'].includes(g.cefr), `bad cefr: ${g.id}`);
    assert.equal(g.examples.length, 2, `examples: ${g.id}`);
    assert.ok(g.formula.length > 0 && g.name.length > 0 && g.zh.length > 0);
  }
  const counts = Object.fromEntries(['A1', 'A2', 'B1', 'B2'].map((c) => [c, grammarByCefr(c as 'A1').length]));
  for (const c of Object.values(counts)) assert.ok(c >= 20, `level underfilled: ${JSON.stringify(counts)}`);
});
