/**
 * 建表兜底 DDL：与 ./schema.ts 逐列对齐（蛇形命名）。
 * 用途：Docker/全新环境无 drizzle-kit（devDependency）时的开箱初始化；
 * getDb() 打开连接即执行，CREATE ... IF NOT EXISTS 幂等，对已有库无操作。
 * schema.ts 改动时必须同步本文件（init.test 有列对齐回归）。
 */
import type Database from 'better-sqlite3';

export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS learners (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  native_lang text NOT NULL DEFAULT 'zh',
  locked integer NOT NULL DEFAULT 0,
  interests_json text NOT NULL DEFAULT '[]',
  recalibrate_at integer,
  created_at integer NOT NULL
);
CREATE TABLE IF NOT EXISTS skill_levels (
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  skill text NOT NULL,
  theta real NOT NULL DEFAULT 50,
  confidence real NOT NULL DEFAULT 0,
  ewma real NOT NULL DEFAULT 50,
  streak_up integer NOT NULL DEFAULT 0,
  streak_down integer NOT NULL DEFAULT 0,
  updated_at integer NOT NULL,
  PRIMARY KEY (learner_id, skill)
);
CREATE TABLE IF NOT EXISTS placement_runs (
  id text PRIMARY KEY NOT NULL,
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  mode text NOT NULL,
  result_json text NOT NULL,
  created_at integer NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY NOT NULL,
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  module text NOT NULL,
  scenario_json text,
  created_at integer NOT NULL,
  ended_at integer
);
CREATE INDEX IF NOT EXISTS sessions_learner_created ON sessions (learner_id, created_at);
CREATE TABLE IF NOT EXISTS turns (
  id text PRIMARY KEY NOT NULL,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  user_text text,
  assistant_text text,
  meta_json text,
  created_at integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS turns_session_idx ON turns (session_id, idx);
CREATE TABLE IF NOT EXISTS vocab_states (
  id text PRIMARY KEY NOT NULL,
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  word text NOT NULL,
  cefr text,
  band integer,
  source text,
  state text NOT NULL DEFAULT 'learning',
  fsrs_state integer NOT NULL DEFAULT 0,
  stability real NOT NULL DEFAULT 0,
  difficulty real NOT NULL DEFAULT 0,
  reps integer NOT NULL DEFAULT 0,
  lapses integer NOT NULL DEFAULT 0,
  due_at integer,
  first_seen_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS vocab_learner_due ON vocab_states (learner_id, due_at);
CREATE UNIQUE INDEX IF NOT EXISTS vocab_learner_word ON vocab_states (learner_id, word);
CREATE TABLE IF NOT EXISTS grammar_states (
  id text PRIMARY KEY NOT NULL,
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  grammar_id text NOT NULL,
  state text NOT NULL DEFAULT 'unknown',
  fsrs_state integer NOT NULL DEFAULT 0,
  stability real NOT NULL DEFAULT 0,
  difficulty real NOT NULL DEFAULT 0,
  reps integer NOT NULL DEFAULT 0,
  lapses integer NOT NULL DEFAULT 0,
  due_at integer
);
CREATE INDEX IF NOT EXISTS grammar_learner_due ON grammar_states (learner_id, due_at);
CREATE UNIQUE INDEX IF NOT EXISTS grammar_learner_grammar ON grammar_states (learner_id, grammar_id);
CREATE TABLE IF NOT EXISTS articles (
  id text PRIMARY KEY NOT NULL,
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  topic text NOT NULL,
  title text NOT NULL,
  cefr text NOT NULL,
  body text NOT NULL,
  vocab_json text,
  grammar_json text,
  sources_json text,
  quiz_json text,
  flagged_json text,
  overband_ratio real,
  created_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS articles_learner_created ON articles (learner_id, created_at);
CREATE TABLE IF NOT EXISTS prompt_audit (
  id text PRIMARY KEY NOT NULL,
  prompt_name text NOT NULL,
  version integer NOT NULL,
  hash text NOT NULL,
  created_at integer NOT NULL
);
CREATE TABLE IF NOT EXISTS error_ledger (
  id text PRIMARY KEY NOT NULL,
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  session_id text,
  wrong text NOT NULL,
  fix text NOT NULL,
  note text,
  grammar_id text,
  resolved integer NOT NULL DEFAULT 0,
  created_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS error_learner_resolved ON error_ledger (learner_id, resolved);
CREATE TABLE IF NOT EXISTS learning_events (
  id text PRIMARY KEY NOT NULL,
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  skill text NOT NULL,
  score real NOT NULL,
  source text NOT NULL,
  detail text,
  created_at integer NOT NULL
);
CREATE INDEX IF NOT EXISTS learning_events_learner_time ON learning_events (learner_id, created_at);
CREATE TABLE IF NOT EXISTS ai_usage (
  id text PRIMARY KEY NOT NULL,
  capability text NOT NULL DEFAULT 'llm',
  driver text NOT NULL,
  model text,
  module text NOT NULL DEFAULT 'unknown',
  prompt_tokens integer,
  completion_tokens integer,
  latency_ms integer,
  success integer NOT NULL DEFAULT 1,
  created_at integer NOT NULL
);
`;

/** 幂等建表：全新库一次成型；已初始化的库无操作 */
export function ensureSchema(sqlite: Database.Database): void {
  sqlite.exec(SCHEMA_DDL);
}
