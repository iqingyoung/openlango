import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { ensureLearner, getBands, getLlm, getDb, SETTINGS_PATHS } from '@/lib/server';
import { vocabStates, grammarStates, skillLevels, isDue } from '@openlango/core';

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
  return NextResponse.json({
    name: learner.name,
    bands,
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
