/**
 * SQLite schema（Drizzle）。M0 冻结表结构：学习者/五维等级/placement/会话/轮次/
 * 词汇状态(FSRS)/语法状态/文章/prompt 审计。
 * 宪章：模型可换，学习状态持久 —— 所有状态落库，不进模型。
 */
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const learners = sqliteTable('learners', {
  id: text('id').primaryKey(), // uuid
  name: text('name').notNull(),
  nativeLang: text('native_lang').notNull().default('zh'),
  locked: integer('locked', { mode: 'boolean' }).notNull().default(false), // 手动锁级
  interestsJson: text('interests_json').notNull().default('[]'),
  /** 信号漂移超阈值时置位：建议重新校准（不打扰式提示，placement 完成后清除） */
  recalibrateAt: integer('recalibrate_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** 五维等级向量：每学习者每技能一行（ewma/streak 供 LevelManager 滞回防抖） */
export const skillLevels = sqliteTable(
  'skill_levels',
  {
    learnerId: text('learner_id').notNull(),
    skill: text('skill').notNull(), // reading|listening|speaking|vocabulary|grammar
    theta: real('theta').notNull().default(50),
    confidence: real('confidence').notNull().default(0),
    ewma: real('ewma').notNull().default(50),
    streakUp: integer('streak_up').notNull().default(0),
    streakDown: integer('streak_down').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.learnerId, t.skill] })],
);

export const placementRuns = sqliteTable('placement_runs', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id').notNull(),
  mode: text('mode').notNull(), // placement | recalibration
  resultJson: text('result_json').notNull(), // 五维 θ + confidence + 证据
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id').notNull(),
  module: text('module').notNull(), // coach|article|basic
  scenarioJson: text('scenario_json'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  endedAt: integer('ended_at', { mode: 'timestamp' }),
});

export const turns = sqliteTable(
  'turns',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    idx: integer('idx').notNull(),
    userText: text('user_text'),
    assistantText: text('assistant_text'),
    /** 信号：纠错数/目标词使用/judge 原始输出 → EWMA 融合的数据源 */
    metaJson: text('meta_json'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('turns_session_idx').on(t.sessionId, t.idx)],
);

/** learned_set + 掌握状态：运行时 LLM 只映射不发明，词条须能对回 data/vocab.json */
export const vocabStates = sqliteTable(
  'vocab_states',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    word: text('word').notNull(),
    cefr: text('cefr'),
    band: integer('band'),
    source: text('source'),
    /** FSRS 字段（fsrsState 是 ts-fsrs 卡片状态整数，与学习流程 state 分离） */
    state: text('state').notNull().default('learning'), // learning|review|mastered
    fsrsState: integer('fsrs_state').notNull().default(0),
    stability: real('stability').notNull().default(0),
    difficulty: real('difficulty').notNull().default(0),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    dueAt: integer('due_at', { mode: 'timestamp' }),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('vocab_learner_due').on(t.learnerId, t.dueAt)],
);

/** 语法点状态：grammarId 对回 data/grammar.json 的固定清单 */
export const grammarStates = sqliteTable(
  'grammar_states',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    grammarId: text('grammar_id').notNull(), // data/grammar.json id
    state: text('state').notNull().default('unknown'), // unknown|exposure|practice|test|mastered
    fsrsState: integer('fsrs_state').notNull().default(0),
    stability: real('stability').notNull().default(0),
    difficulty: real('difficulty').notNull().default(0),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    dueAt: integer('due_at', { mode: 'timestamp' }),
  },
  (t) => [index('grammar_learner_due').on(t.learnerId, t.dueAt)],
);

export const articles = sqliteTable('articles', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id').notNull(),
  topic: text('topic').notNull(),
  title: text('title').notNull(),
  cefr: text('cefr').notNull(),
  body: text('body').notNull(),
  vocabJson: text('vocab_json'), // 新词提取结果
  grammarJson: text('grammar_json'), // 映射到的语法点 id
  sourcesJson: text('sources_json'), // RSS topic 信号来源（原文链接）
  quizJson: text('quiz_json'), // 理解题（answer 留服务端）
  flaggedJson: text('flagged_json'), // 被间接注入过滤拦截的片段
  overbandRatio: real('overband_ratio'), // 输出侧等级硬锁校验结果
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** prompt 版本审计：模板每次渲染记录 hash，回归可追 */
export const promptAudit = sqliteTable('prompt_audit', {
  id: text('id').primaryKey(),
  promptName: text('prompt_name').notNull(),
  version: integer('version').notNull(),
  hash: text('hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** 错误台账：judge 纠错沉淀（wrong/fix + 映射到的固定语法点），答对销账，驱动复习优先级 */
export const errorLedger = sqliteTable(
  'error_ledger',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    sessionId: text('session_id'),
    wrong: text('wrong').notNull(),
    fix: text('fix').notNull(),
    note: text('note'),
    grammarId: text('grammar_id'), // data/grammar.json id（judge 映射，只映射不发明）
    resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('error_learner_resolved').on(t.learnerId, t.resolved)],
);

/** 学习证据台账：技能信号的唯一审计源（哪维/多少分/来自哪条管线），回答"为什么升级" */
export const learningEvents = sqliteTable(
  'learning_events',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    skill: text('skill').notNull(), // reading|listening|speaking|vocabulary|grammar
    score: real('score').notNull(), // 0-100，θ 同尺度
    source: text('source').notNull(), // coach_judge|voice_judge|article_quiz|basic_drill|placement
    detail: text('detail'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('learning_events_learner_time').on(t.learnerId, t.createdAt)],
);
