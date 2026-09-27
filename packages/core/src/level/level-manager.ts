/**
 * LevelManager：无感升降级核心（纯逻辑）。
 * - 五维各自独立维护 θ + EWMA 性能信号
 * - 带内自由漂移（每更新 ±0.5 封顶）；跨带必须过滞回：升级需 EWMA ≥ 目标带下界+2 连续 3 次，
 *   降级需 EWMA ≤ 当前带下界−5 连续 5 次（降级伤自尊，宁可保守）
 * - UI 永不展示 θ 数值，只映射 CEFR 展示
 */
import { CEFR_BANDS, clampTheta, thetaToCefr, type CEFR, type Skill } from './cefr.ts';

export const EWMA_ALPHA = 0.35;
export const MAX_STEP_PER_UPDATE = 0.5;
export const UPGRADE_MARGIN = 2;
export const DOWNGRADE_MARGIN = 5;
export const UPGRADE_STREAK = 3;
export const DOWNGRADE_STREAK = 5;

export interface SkillState {
  theta: number;
  ewma: number;
  streakUp: number;
  streakDown: number;
}

export function newSkillState(theta: number): SkillState {
  return { theta: clampTheta(theta), ewma: clampTheta(theta), streakUp: 0, streakDown: 0 };
}

export function bandIndex(theta: number): number {
  let idx = 0;
  for (let i = 0; i < CEFR_BANDS.length; i++) {
    if (theta >= CEFR_BANDS[i]!.min) idx = i;
  }
  return idx;
}

export function bandOf(theta: number): CEFR {
  return thetaToCefr(theta);
}

/**
 * 施加一次表现信号 p ∈ [0,100]（θ 同尺度）。
 * streak 每次更新独立累计（条件成立 +1 否则清零），与是否跨带解耦：
 * 带内等待期 streak 照常增长，条件满足后才放行跨带。
 */
export function applySignal(st: SkillState, p: number): SkillState {
  const perf = clampTheta(p);
  const ewma = EWMA_ALPHA * perf + (1 - EWMA_ALPHA) * st.ewma;
  const from = bandIndex(st.theta);
  const nextBandMin = from + 1 < CEFR_BANDS.length ? CEFR_BANDS[from + 1]!.min : null;
  const curBandMin = CEFR_BANDS[from]!.min;

  const upCond = nextBandMin !== null && ewma >= nextBandMin + UPGRADE_MARGIN;
  const downCond = ewma <= curBandMin - DOWNGRADE_MARGIN;
  const streakUp = upCond ? st.streakUp + 1 : 0;
  const streakDown = downCond ? st.streakDown + 1 : 0;

  const step = Math.max(-MAX_STEP_PER_UPDATE, Math.min(MAX_STEP_PER_UPDATE, ewma - st.theta));
  let theta = clampTheta(st.theta + step);
  const to = bandIndex(theta);

  if (to > from && streakUp < UPGRADE_STREAK) theta = Math.min(theta, nextBandMin! - 0.01);
  if (to < from && streakDown < DOWNGRADE_STREAK) theta = Math.max(theta, curBandMin);
  return { theta: clampTheta(theta), ewma, streakUp, streakDown };
}

/** 会话级便捷封装：一次会话多个信号 → 依次应用 */
export function applySignals(st: SkillState, ps: number[]): SkillState {
  let cur = st;
  for (const p of ps) cur = applySignal(cur, p);
  return cur;
}

export type SkillVectorState = Record<Skill, SkillState>;

export function newVectorState(vector: Record<Skill, number>): SkillVectorState {
  return {
    reading: newSkillState(vector.reading),
    listening: newSkillState(vector.listening),
    speaking: newSkillState(vector.speaking),
    vocabulary: newSkillState(vector.vocabulary),
    grammar: newSkillState(vector.grammar),
  };
}

/** 展示用：θ → CEFR（UI 唯一允许展示的东西） */
export function displayBands(state: SkillVectorState): Record<Skill, CEFR> {
  return {
    reading: bandOf(state.reading.theta),
    listening: bandOf(state.listening.theta),
    speaking: bandOf(state.speaking.theta),
    vocabulary: bandOf(state.vocabulary.theta),
    grammar: bandOf(state.grammar.theta),
  };
}
