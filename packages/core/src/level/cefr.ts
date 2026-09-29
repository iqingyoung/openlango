/**
 * 等级模型（M0：类型与映射；ELO/EWMA 融合引擎在 M1 实现）。
 * 五维连续 θ ∈ [0,100]，CEFR 仅作展示映射。
 * 定级由文字模块驱动，语音难度跟随。
 */

export type Skill = 'reading' | 'listening' | 'speaking' | 'vocabulary' | 'grammar';

export type SkillVector = Record<Skill, number>;

export type CEFR = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

/** CEFR 分带下界（θ: 0-100） */
export const CEFR_BANDS: ReadonlyArray<{ cefr: CEFR; min: number }> = [
  { cefr: 'A1', min: 0 },
  { cefr: 'A2', min: 12 },
  { cefr: 'B1', min: 30 },
  { cefr: 'B2', min: 50 },
  { cefr: 'C1', min: 68 },
  { cefr: 'C2', min: 85 },
];

export function thetaToCefr(theta: number): CEFR {
  let out: CEFR = 'A1';
  for (const b of CEFR_BANDS) {
    if (theta >= b.min) out = b.cefr;
  }
  return out;
}

export function cefrToThetaMidpoint(cefr: CEFR): number {
  const idx = CEFR_BANDS.findIndex((b) => b.cefr === cefr);
  const lower = CEFR_BANDS[idx]!.min;
  const upper = idx + 1 < CEFR_BANDS.length ? CEFR_BANDS[idx + 1]!.min : 100;
  return (lower + upper) / 2;
}

// ---------- State 三视图：同一 learner state 的三种合法投影，禁止跨视图取值 ----------

/** Prompt 视图：只暴露 CEFR 展示带（renderLevelBlock 的输出契约），永不含 θ */
export type LearnerStatePrompt = Record<Skill, CEFR>;

/** Public 视图：CEFR + 带内进度（UI 展示契约），永不含 θ */
export interface LearnerStatePublic {
  bands: Record<Skill, CEFR>;
  progress: Record<Skill, number>;
}

/** 等级门控块（Prompt 视图投影）：只给 CEFR 展示带；
 * θ 数值属 Internal 视图（DB/LevelManager），不进任何 prompt。 */
export function renderLevelBlock(vector: SkillVector): string {
  const parts = Object.entries(vector).map(([skill, theta]) => `${skill}: ${thetaToCefr(theta)}`);
  return `Assessed CEFR profile: ${parts.join('; ')}. Content difficulty must match these levels — do not exceed them.`;
}

/** 单维 θ 的合法范围钳制 */
export function clampTheta(theta: number): number {
  return Math.max(0, Math.min(100, theta));
}
