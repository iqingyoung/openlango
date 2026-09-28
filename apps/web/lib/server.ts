/**
 * 服务端单例：仓库根定位、.env 装载、配置→providers、DB、learner 与技能状态读写。
 * 宪章：模型可换（配置驱动），学习状态持久（全部落库）。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, asc, eq } from 'drizzle-orm';
import { loadConfig } from '@openlango/providers/config';
import { createProviders, type ProviderSet } from '@openlango/providers';
import type { ASRProvider, EvaluatorProvider, LLMProvider, OpenLangoConfig, SearchProvider, Skill, TTSProvider } from '@openlango/core';
import {
  learners,
  skillLevels,
  learningEvents,
  newVectorState,
  applySignal as applySignalCore,
  displayBands,
  type SkillVectorState,
} from '@openlango/core';

// ---------- 仓库根定位（next dev 的 cwd 是 apps/web） ----------

function findRepoRoot(): string {
  // 容器/打包环境目录结构变化，显式 env 优先
  if (process.env.OPENLANGO_ROOT) return process.env.OPENLANGO_ROOT;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'config/openlango.config.yaml'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();

/** 设置页展示的真实路径（动态解析，不写死） */
export const SETTINGS_PATHS = {
  repoRoot: REPO_ROOT,
  envFile: join(REPO_ROOT, '.env'),
  configFile: join(REPO_ROOT, 'config', 'openlango.config.yaml'),
};

// ---------- .env（不覆盖已有环境变量） ----------

function loadEnvFile(): void {
  const p = join(REPO_ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvFile();

// ---------- 配置与 providers ----------

let configCache: OpenLangoConfig | null = null;
let providersCache: ProviderSet | null = null;

export function getConfig(): OpenLangoConfig {
  configCache ??= loadConfig(join(REPO_ROOT, 'config/openlango.config.yaml'));
  return configCache;
}

export function getProviders() {
  providersCache ??= createProviders(getConfig());
  return providersCache;
}

export function getLlm(): LLMProvider | null {
  return getProviders().llm ?? null;
}

/** 独立评分通道：配置了 evaluator 能力位才有（judge 与对话 LLM 解耦） */
export function getEvaluator(): EvaluatorProvider | null {
  return getProviders().evaluator ?? null;
}

export function getAsr(): ASRProvider | null {
  return getProviders().asr ?? null;
}

export function getTts(): TTSProvider | null {
  return getProviders().tts ?? null;
}

// ---------- DB ----------

type DB = BetterSQLite3Database<Record<string, never>>;

// Next dev HMR 会重新执行模块：连接句柄挂 globalThis 防止多连接导致锁与状态分裂
const globalStore = globalThis as unknown as { __openlangoDb?: DB };

export function getDb(): DB {
  if (globalStore.__openlangoDb) return globalStore.__openlangoDb;
  const file = getConfig().database?.file ?? 'data/openlango.db';
  const dbPath = file.startsWith('/') ? file : join(REPO_ROOT, file);
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000'); // 并发写锁重试，避免 SQLITE_BUSY
  sqlite.pragma('synchronous = NORMAL'); // WAL 模式下的安全/吞吐平衡
  sqlite.pragma('foreign_keys = ON'); // 级联删除与引用完整性
  globalStore.__openlangoDb = drizzle(sqlite);
  return globalStore.__openlangoDb;
}

// ---------- 生成参数（按模块） ----------

export interface GenerationParams {
  temperature?: number;
  maxTokens?: number;
}

type GenerationModule = 'coach' | 'scenario' | 'judge' | 'article' | 'map';

export function getGenerationParams(module: GenerationModule): GenerationParams {
  const gen = getConfig().generation as Record<string, GenerationParams> | undefined;
  return gen?.[module] ?? {};
}

// ---------- Learner ----------

export async function getLearner() {
  const db = getDb();
  const rows = await db.select().from(learners).orderBy(asc(learners.createdAt)).limit(1);
  return rows[0] ?? null;
}

export async function ensureLearner() {
  const existing = await getLearner();
  if (existing) return existing;
  const db = getDb();
  const id = crypto.randomUUID();
  await db.insert(learners).values({ id, name: 'local learner' });
  for (const skill of ['reading', 'listening', 'speaking', 'vocabulary', 'grammar'] as const) {
    await db
      .insert(skillLevels)
      .values({ learnerId: id, skill, theta: 50, ewma: 50, confidence: 0 })
      .onConflictDoNothing();
  }
  return (await getLearner())!;
}

// ---------- 技能状态 ----------

const SKILLS: Skill[] = ['reading', 'listening', 'speaking', 'vocabulary', 'grammar'];

export async function loadSkillStates(learnerId: string): Promise<SkillVectorState> {
  const db = getDb();
  const rows = await db.select().from(skillLevels).where(eq(skillLevels.learnerId, learnerId));
  const vector: Partial<Record<Skill, number>> = {};
  for (const s of SKILLS) {
    const row = rows.find((r) => r.skill === s);
    vector[s] = row?.theta ?? 50;
  }
  const state = newVectorState(vector as Record<Skill, number>);
  // 恢复 ewma/streak
  for (const s of SKILLS) {
    const row = rows.find((r) => r.skill === s);
    if (row) {
      state[s].ewma = row.ewma;
      state[s].streakUp = row.streakUp;
      state[s].streakDown = row.streakDown;
    }
  }
  return state;
}

export async function saveSkillStates(learnerId: string, state: SkillVectorState): Promise<void> {
  const db = getDb();
  for (const s of SKILLS) {
    await db
      .update(skillLevels)
      .set({
        theta: state[s].theta,
        ewma: state[s].ewma,
        streakUp: state[s].streakUp,
        streakDown: state[s].streakDown,
        updatedAt: new Date(),
      })
      .where(and(eq(skillLevels.learnerId, learnerId), eq(skillLevels.skill, s)));
  }
}

/** 学习证据：任何模块要影响 learner state，只能提交证据，不得直接写 skill_levels */
export type EvidenceSource = 'coach_judge' | 'voice_judge' | 'article_quiz' | 'basic_drill' | 'placement';

export interface LearningEvidence {
  skill: Skill;
  /** 0-100 θ 同尺度表现分，越界截断，非数值静默丢弃 */
  score: number;
  source: EvidenceSource;
  detail?: string;
}

/**
 * learner state 唯一运行时写入入口：Evidence → LevelManager → DB + 台账。
 * （例外：placement 完成时的基线写入走 calibration 路径，不经此处）
 */
export async function recordLearningEvidence(learnerId: string, evidence: LearningEvidence): Promise<void> {
  if (!SKILLS.includes(evidence.skill)) throw new Error(`recordLearningEvidence: unknown skill ${evidence.skill}`);
  const score = Number(evidence.score);
  if (!Number.isFinite(score)) return; // 非法信号（judge 失败等）静默丢弃
  const clamped = Math.max(0, Math.min(100, score));
  const state = await loadSkillStates(learnerId);
  state[evidence.skill] = applySignalCore(state[evidence.skill], clamped);
  await saveSkillStates(learnerId, state);
  await getDb().insert(learningEvents).values({
    id: crypto.randomUUID(),
    learnerId,
    skill: evidence.skill,
    score: clamped,
    source: evidence.source,
    detail: evidence.detail ?? null,
  });
}

/** 展示用 bands（UI 永不见 θ 数值） */
export async function getBands(learnerId: string) {
  const state = await loadSkillStates(learnerId);
  return displayBands(state);
}

// ---------- M3：审计 pass（角色漂移）+ 错误台账 + 再校准触发 ----------

import { desc } from 'drizzle-orm';
import { errorLedger, turns as turnsTable } from '@openlango/core';

export interface DriftReport {
  drifted: boolean;
  reasons: string[];
}

/** 读某会话最后一轮是否被审计为漂移（漂移 → 下轮 system prompt 加固） */
export async function getLastTurnDrift(sessionId: string): Promise<DriftReport | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(turnsTable)
    .where(eq(turnsTable.sessionId, sessionId))
    .orderBy(desc(turnsTable.idx))
    .limit(1);
  const meta = rows[0]?.metaJson;
  if (!meta) return null;
  try {
    const parsed = JSON.parse(meta) as { audit?: DriftReport };
    if (parsed.audit && typeof parsed.audit.drifted === 'boolean') return parsed.audit;
  } catch {
    // ignore
  }
  return null;
}

/** 纠错沉淀进错误台账（judge.grammarIds 与 corrections 按位对齐，越界丢弃） */
export async function insertLedgerRows(
  learnerId: string,
  sessionId: string,
  judge: { corrections: Array<{ wrong: string; fix: string; note?: string }>; grammarIds?: string[] },
): Promise<void> {
  const db = getDb();
  const rows = judge.corrections.map((c, i) => ({
    id: crypto.randomUUID(),
    learnerId,
    sessionId,
    wrong: c.wrong,
    fix: c.fix,
    note: c.note ?? null,
    grammarId: judge.grammarIds?.[i] ?? null,
  }));
  if (rows.length > 0) await db.insert(errorLedger).values(rows);
}

/** 未销账错误按语法点聚合（驱动 Basic 复习优先级） */
export async function unresolvedErrorCounts(learnerId: string): Promise<Map<string, number>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(errorLedger)
    .where(and(eq(errorLedger.learnerId, learnerId), eq(errorLedger.resolved, false)));
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.grammarId) continue;
    counts.set(r.grammarId, (counts.get(r.grammarId) ?? 0) + 1);
  }
  return counts;
}

/** 答对销账 */
export async function resolveLedgerForGrammar(learnerId: string, grammarId: string): Promise<void> {
  const db = getDb();
  await db
    .update(errorLedger)
    .set({ resolved: true })
    .where(
      and(eq(errorLedger.learnerId, learnerId), eq(errorLedger.grammarId, grammarId), eq(errorLedger.resolved, false)),
    );
}

/** 信号漂移检测：近 7 天未销账错误 ≥8 → 置再校准标记（placement 完成后清除） */
export async function checkRecalibration(learnerId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(errorLedger)
    .where(and(eq(errorLedger.learnerId, learnerId), eq(errorLedger.resolved, false)));
  const recent = rows.filter((r) => Date.now() - (r.createdAt?.getTime() ?? 0) < 7 * 86400_000);
  if (recent.length >= 8) {
    await db.update(learners).set({ recalibrateAt: new Date() }).where(eq(learners.id, learnerId));
  }
}

/** 审计 pass：角色一致性检查 + 回写轮次 meta（fire-and-forget 调用，不挡对话） */
export async function auditTurn(opts: {
  turnId: string;
  reply: string;
  scenario: { persona: string; goal: string };
  llm: LLMProvider;
}): Promise<void> {
  try {
    const { checkRoleConsistency } = await import('@openlango/core');
    const report = await checkRoleConsistency({ reply: opts.reply, scenario: opts.scenario as never, llm: opts.llm });
    if (!report) return;
    const db = getDb();
    const rows = await db.select().from(turnsTable).where(eq(turnsTable.id, opts.turnId));
    const row = rows[0];
    if (!row) return;
    let meta: Record<string, unknown> = {};
    if (row.metaJson) {
      try {
        meta = JSON.parse(row.metaJson) as Record<string, unknown>;
      } catch {
        meta = {};
      }
    }
    meta.audit = report;
    await db.update(turnsTable).set({ metaJson: JSON.stringify(meta) }).where(eq(turnsTable.id, opts.turnId));
  } catch {
    // 审计失败静默
  }
}
