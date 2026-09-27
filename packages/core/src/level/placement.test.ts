import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlacementEngine, makeClozeItem, makeIdentifyItem, nextPlacementItem, mulberry32 } from './placement.ts';
import { GRAMMAR } from '../data/index.ts';

test('cloze 题结构完整且答案在选项内', () => {
  const rng = mulberry32(42);
  const g = GRAMMAR.find((x) => x.id === 'g004')!;
  const item = makeClozeItem(g, rng, 0);
  assert.equal(item.kind, 'cloze');
  assert.equal(item.options.length, 4);
  assert.ok(new Set(item.options).size === 4, 'options unique');
  assert.ok(item.prompt.includes('___'));
  assert.ok(item.options[item.answer]!.length > 0);
});

test('结构识别题：正确句来自该语法点', () => {
  const rng = mulberry32(7);
  const g = GRAMMAR.find((x) => x.id === 'g062')!;
  const item = makeIdentifyItem(g, rng, 0);
  assert.equal(item.kind, 'identify');
  assert.equal(item.options.length, 4);
  assert.equal(new Set(item.options).size, 4);
  assert.ok(item.options[item.answer] === g.examples[0]);
});

test('确定性：同 seed 同题', () => {
  const a = nextPlacementItem(new PlacementEngine(1, 50), { theta: 50, count: 0, askedIds: [], lastDelta: 0, seed: 1 }, mulberry32(99));
  const b = nextPlacementItem(new PlacementEngine(1, 50), { theta: 50, count: 0, askedIds: [], lastDelta: 0, seed: 1 }, mulberry32(99));
  assert.deepEqual(a, b);
});

/** 模拟学习者：真实能力 A，按 logistic 答题 */
function simulatePlacement(ability: number, seed: number): number {
  const rng = mulberry32(seed);
  const engine = new PlacementEngine(seed, 50);
  const state = engine.serialize();
  let guard = 0;
  while (!engine.finished && guard++ < 20) {
    const item = nextPlacementItem(engine, state, rng);
    const p = 1 / (1 + 10 ** ((item.difficulty - ability) / 8));
    engine.record(item.difficulty, rng() < p);
    const s = engine.serialize();
    state.count = s.count;
    state.askedIds = s.askedIds;
    state.lastDelta = s.lastDelta;
  }
  return engine.theta;
}

test('placement 仿真：三种能力恢复到 ±15 内', () => {
  for (const [ability, seed] of [[25, 1], [45, 2], [58, 3]] as const) {
    const theta = simulatePlacement(ability, seed);
    assert.ok(Math.abs(theta - ability) <= 15, `ability ${ability} → theta ${theta}`);
  }
});

test('placement 最多 8 题收敛', () => {
  const rng = mulberry32(5);
  const engine = new PlacementEngine(5, 50);
  const state = engine.serialize();
  let guard = 0;
  while (!engine.finished && guard++ < 20) {
    const item = nextPlacementItem(engine, state, rng);
    engine.record(item.difficulty, rng() < 0.5);
    const s = engine.serialize();
    state.count = s.count;
    state.askedIds = s.askedIds;
    state.lastDelta = s.lastDelta;
  }
  assert.ok(engine.count <= 8);
});

test('状态序列化往返', () => {
  const e = new PlacementEngine(3, 40);
  e.record(40, true);
  const restored = PlacementEngine.from(e.serialize());
  assert.equal(restored.theta, e.theta);
  assert.equal(restored.count, e.count);
  restored.record(40, false);
  assert.notEqual(restored.theta, e.theta);
});
