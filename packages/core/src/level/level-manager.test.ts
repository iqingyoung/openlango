import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applySignal,
  applySignals,
  bandOf,
  bandProgress,
  newSkillState,
  newVectorState,
  displayBands,
} from './level-manager.ts';
import { CEFR_BANDS } from './cefr.ts';

test('带内漂移：θ 追随 EWMA，步长封顶 ±0.5', () => {
  let st = newSkillState(25);
  for (let i = 0; i < 10; i++) st = applySignal(st, 60);
  assert.ok(st.theta > 25 && st.theta <= 25 + 10 * 0.5 + 1e-9);
  assert.equal(bandOf(st.theta), 'B1'); // 25+5=30... 检查滞回
});

test('30 会话进步用户：A2 → B1 平滑迁移不抖动', () => {
  let st = newSkillState(25); // A2
  const bands: string[] = [];
  for (let i = 0; i < 30; i++) {
    st = applySignal(st, 30 + i); // 表现线性上升 30→59
    bands.push(bandOf(st.theta));
  }
  assert.equal(bandOf(st.theta), 'B1');
  // θ 单调不回撤（进步用户）
  assert.ok(st.theta >= 30);
  // 迁移完成后不再回 A2
  const idxA2 = bands.lastIndexOf('A2');
  const idxB1 = bands.indexOf('B1');
  assert.ok(idxB1 > idxA2 && idxB1 > 2, `transition at ${idxB1}`);
});

test('滞回：临界震荡的表现不引起带翻转', () => {
  let st = newSkillState(50); // B1 上沿（50 是 B2 下界）
  const seen = new Set<string>();
  for (let i = 0; i < 30; i++) {
    st = applySignal(st, i % 2 === 0 ? 55 : 45); // 在边界两侧震荡
    seen.add(bandOf(st.theta));
  }
  assert.equal(seen.size, 1, `bands seen: ${[...seen].join(',')}`);
});

test('降级保守：需 EWMA 低于带下界 5 分连续 5 次', () => {
  let st = newSkillState(40); // B1
  for (let i = 0; i < 40; i++) st = applySignal(st, 20); // 持续差表现：streak 达标后 θ 逐步下穿
  assert.equal(bandOf(st.theta), 'A2'); // 最终降级
  // 但只给 4 次差表现不降
  let st2 = newSkillState(40);
  for (let i = 0; i < 4; i++) st2 = applySignal(st2, 20);
  assert.equal(bandOf(st2.theta), 'B1');
});

test('升级需连续 3 次超过目标带下界+2', () => {
  let st = newSkillState(28); // A2 靠上
  st = applySignal(st, 45); // ewma=34.45 ≥ 30+2 但 streak=1
  assert.equal(bandOf(st.theta), 'A2');
  st = applySignal(st, 45); // streak=2
  assert.equal(bandOf(st.theta), 'A2');
  st = applySignal(st, 45); // streak=3 放行跨带，但 θ 步进仍受 ±0.5 限制
  assert.equal(bandOf(st.theta), 'A2');
  st = applySignal(st, 45); // θ=30 触达 B1
  assert.equal(bandOf(st.theta), 'B1');
});

test('一次差表现不重置升级后的位置（EWMA 平滑）', () => {
  let st = newSkillState(45);
  for (let i = 0; i < 15; i++) st = applySignal(st, 55);
  const good = st.theta;
  st = applySignal(st, 10); // 单次崩盘
  assert.ok(st.theta >= good - 0.5, 'single bad session must not tank theta');
});

test('五维状态与展示映射', () => {
  const v = newVectorState({ reading: 55, listening: 40, speaking: 32, vocabulary: 48, grammar: 44 });
  const bands = displayBands(v);
  assert.equal(bands.reading, 'B2');
  assert.equal(bands.speaking, 'B1');
  assert.equal(Object.keys(v).length, 5);
});

test('applySignals 连续应用', () => {
  const st = applySignals(newSkillState(20), [60, 60, 60, 60]);
  assert.ok(st.ewma > 40);
});

test('bandProgress 带内进度', () => {
  // 各带下界进度为 0，上界趋近 1；顶带封顶 1
  const bands = CEFR_BANDS.map((b) => b.min);
  assert.ok(Math.abs(bandProgress(bands[0]!)) < 1e-9, 'band min = 0');
  assert.ok(Math.abs(bandProgress(bands[1]!) - 0) < 1e-9, 'next band min resets progress');
  assert.ok(bandProgress((bands[0]! + bands[1]!) / 2) > 0.49, 'mid band ~0.5');
  assert.ok(bandProgress(99.9) > 0.99 && bandProgress(99.9) < 1, 'near top but not over');
  assert.ok(bandProgress(100) >= 0 && bandProgress(100) <= 1);
});
