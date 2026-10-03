import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { ensureSchema } from './init.ts';
import { learners, skillLevels, turns, sessions, aiUsage, vocabStates } from './schema.ts';

test('ensureSchema：全新空库一次成型且幂等', () => {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  ensureSchema(sqlite);
  ensureSchema(sqlite); // 幂等：二次执行不报错
  const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
  for (const t of ['learners', 'skill_levels', 'placement_runs', 'sessions', 'turns', 'vocab_states', 'grammar_states', 'articles', 'prompt_audit', 'error_ledger', 'learning_events', 'ai_usage']) {
    assert.ok(tables.includes(t), `缺表: ${t}`);
  }
});

test('ensureSchema 的 DDL 与 drizzle schema 列对齐（可插入可查询）', async () => {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  ensureSchema(sqlite);
  const db = drizzle(sqlite);
  const id = crypto.randomUUID();
  await db.insert(learners).values({ id, name: 't' });
  await db.insert(skillLevels).values({ learnerId: id, skill: 'reading', theta: 50 });
  const sid = crypto.randomUUID();
  await db.insert(sessions).values({ id: sid, learnerId: id, module: 'coach' });
  await db.insert(turns).values({ id: crypto.randomUUID(), sessionId: sid, idx: 0 });
  await db.insert(vocabStates).values({ id: crypto.randomUUID(), learnerId: id, word: 'test' });
  await db.insert(aiUsage).values({ id: crypto.randomUUID(), driver: 'openai-compat' });
  const rows = await db.select().from(skillLevels);
  assert.equal(rows.length, 1);
  // 唯一约束生效：同 (learner,word) 重复插入被拒
  await assert.rejects(() => db.insert(vocabStates).values({ id: crypto.randomUUID(), learnerId: id, word: 'test' }));
});
