import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CEFR_BANDS, cefrToThetaMidpoint, clampTheta, renderLevelBlock, thetaToCefr } from './cefr.ts';

test('theta → CEFR 分带', () => {
  assert.equal(thetaToCefr(0), 'A1');
  assert.equal(thetaToCefr(11.9), 'A1');
  assert.equal(thetaToCefr(12), 'A2');
  assert.equal(thetaToCefr(45), 'B1');
  assert.equal(thetaToCefr(67), 'B2');
  assert.equal(thetaToCefr(84), 'C1');
  assert.equal(thetaToCefr(100), 'C2');
});

test('CEFR → θ 中点往返', () => {
  for (const b of CEFR_BANDS) {
    assert.equal(thetaToCefr(cefrToThetaMidpoint(b.cefr)), b.cefr);
  }
});

test('θ 钳制', () => {
  assert.equal(clampTheta(-5), 0);
  assert.equal(clampTheta(150), 100);
  assert.equal(clampTheta(42), 42);
});

test('levelBlock 渲染五维', () => {
  const block = renderLevelBlock({
    reading: 55,
    listening: 40,
    speaking: 32,
    vocabulary: 48,
    grammar: 44,
  });
  assert.match(block, /reading: B2/);
  assert.match(block, /speaking: B1/);
  assert.match(block, /do not exceed/);
});
