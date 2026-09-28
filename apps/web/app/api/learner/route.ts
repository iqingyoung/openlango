import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { ensureLearner, getBands, getLlm, getDb, SETTINGS_PATHS } from '@/lib/server';
import { vocabStates, grammarStates, skillLevels, sessions, isDue, bandProgress, type Skill } from '@openlango/core';

export async function GET() {
  const learner = await ensureLearner();
  const db = getDb();
  const bands = await getBands(learner.id);
  const now = new Date();
  const vocab = await db.select().from(vocabStates).where(eq(vocabStates.learnerId, learner.id));
  const grammar = await db.select().from(grammarStates).where(eq(grammarStates.learnerId, learner.id));
  const skills = await db.select().from(skillLevels).where(eq(skillLevels.learnerId, learner.id));
  const dueVocab = vocab.filter((r) => isDue({ dueAt: r.dueAt }, now)).length;
  const dueGrammar = grammar.filter((r) => isDue({ dueAt: r.dueAt }, now)).length;
  const masteredWords = vocab.filter((r) => r.state === 'mastered').length;
  // 带内进度：UI 只展示 0-1 进度点，不暴露 θ
  const progress: Partial<Record<Skill, number>> = {};
  for (const s of skills) progress[s.skill as Skill] = bandProgress(s.theta);
  // 最近一次 coach 会话（供仪表盘「继续练习」直达）
  const [last] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.learnerId, learner.id))
    .orderBy(desc(sessions.createdAt))
    .limit(1);
  let lastSession: { id: string; module: string; title: string } | null = null;
  if (last) {
    let title = '';
    try {
      const sc = JSON.parse(last.scenarioJson ?? '{}') as { title?: string };
      title = sc.title ?? '';
    } catch {
      /* 场景数据缺失时留空 */
    }
    lastSession = { id: last.id, module: last.module, title };
  }
  return NextResponse.json({
    name: learner.name,
    bands,
    progress,
    lastSession,
    placed: skills.some((r) => r.confidence > 0),
    suggestRecalibration: learner.recalibrateAt !== null && learner.recalibrateAt !== undefined,
    dueVocab,
    dueGrammar,
    learningWords: vocab.filter((r) => r.state !== 'mastered').length,
    masteredWords,
    llmConfigured: Boolean(getLlm()),
    paths: SETTINGS_PATHS,
  });
}

export const dynamic = 'force-dynamic';
