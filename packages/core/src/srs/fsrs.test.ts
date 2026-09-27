import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptySrsFields, isDue, review, Rating } from './fsrs.ts';

test('新卡：good 后有稳定度且到期日推后', () => {
  const now = new Date('2026-01-01');
  const f0 = emptySrsFields(now);
  assert.ok(isDue(f0, now));
  const f1 = review(f0, Rating.Good, now);
  assert.ok(f1.stability > 0);
  assert.ok(f1.dueAt!.getTime() > now.getTime());
  assert.equal(f1.reps, 1);
  assert.equal(f1.lapses, 0);
});

test('easy 间隔比 good 长', () => {
  const now = new Date('2026-01-01');
  const g = review(emptySrsFields(now), Rating.Good, now);
  const e = review(emptySrsFields(now), Rating.Easy, now);
  assert.ok(e.dueAt!.getTime() > g.dueAt!.getTime());
});

test('复习态 again 会增加 lapses 并缩短间隔', () => {
  const now = new Date('2026-01-01');
  let f = review(emptySrsFields(now), Rating.Good, now);
  f = review(f, Rating.Good, new Date('2026-01-03'));
  const lapsesBefore = f.lapses;
  f = review(f, Rating.Again, new Date('2026-01-06'));
  assert.ok(f.lapses >= lapsesBefore, 'lapses must not decrease');
  assert.ok(f.stability <= 5, 'again 重置稳定度');
});

test('字段往返（模拟 DB 行 → review → 回写）', () => {
  const row = { stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 0, dueAt: null };
  const f1 = review({ ...row, state: 0 }, Rating.Good, new Date('2026-02-01'));
  assert.ok(f1.dueAt !== null);
  const f2 = review({ ...f1 }, Rating.Hard, new Date('2026-02-04'));
  assert.equal(f2.reps, 2);
});
