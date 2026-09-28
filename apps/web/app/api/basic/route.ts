import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { ensureLearner, getDb, recordLearningEvidence, unresolvedErrorCounts, resolveLedgerForGrammar } from '@/lib/server';
import {
  vocabStates,
  grammarStates,
  GRAMMAR,
  isDue,
  review,
  makeDrill,
  prioritizeGrammar,
  type SrsRating,
} from '@openlango/core';

export async function GET() {
  const learner = await ensureLearner();
  const db = getDb();
  const now = new Date();

  const vocabRows = await db
    .select()
    .from(vocabStates)
    .where(and(eq(vocabStates.learnerId, learner.id)))
    .orderBy(asc(vocabStates.dueAt))
    .limit(50);
  const dueVocab = vocabRows
    .filter((r) => isDue({ dueAt: r.dueAt }, now) && r.state !== 'mastered')
    .slice(0, 10)
    .map((r) => ({ id: r.id, word: r.word, cefr: r.cefr }));

  const grammarRows = await db
    .select()
    .from(grammarStates)
    .where(eq(grammarStates.learnerId, learner.id));
  const dueGrammarRows = grammarRows.filter(
    (r) => isDue({ dueAt: r.dueAt }, now) && r.state !== 'mastered',
  );
  const orderedIds = prioritizeGrammar(
    dueGrammarRows.map((r) => ({ grammarId: r.grammarId, state: r.state, dueAt: r.dueAt })),
  );

  // M3：错误台账驱动——有未销账错误的语法点提前，且即使未到期也纳入本轮练测
  const errCounts = await unresolvedErrorCounts(learner.id);
  orderedIds.sort((a, b) => (errCounts.get(b) ?? 0) - (errCounts.get(a) ?? 0));
  for (const [gid] of [...errCounts.entries()].sort((a, b) => b[1] - a[1])) {
    if (orderedIds.length >= 5) break;
    if (orderedIds.includes(gid)) continue;
    if (!GRAMMAR.find((g) => g.id === gid)) continue;
    const existing = grammarRows.find((r) => r.grammarId === gid);
    if (existing) {
      orderedIds.push(gid);
      continue;
    }
    // 无状态行（错误来自教练 judge 映射）→ 现场建 practice 行
    const id = crypto.randomUUID();
    await db.insert(grammarStates).values({
      id,
      learnerId: learner.id,
      grammarId: gid,
      state: 'practice',
      dueAt: new Date(),
    });
    grammarRows.push({
      id,
      learnerId: learner.id,
      grammarId: gid,
      state: 'practice',
      fsrsState: 0,
      stability: 0,
      difficulty: 0,
      reps: 0,
      lapses: 0,
      dueAt: new Date(),
    });
    orderedIds.push(gid);
  }

  const dueGrammar = orderedIds.slice(0, 5).map((gid) => {
    const meta = GRAMMAR.find((g) => g.id === gid)!;
    const row = dueGrammarRows.find((r) => r.grammarId === gid)!;
    const nonce = Math.floor(Math.random() * 1e9);
    const drill = makeDrill(gid, nonce);
    return {
      id: row.id,
      grammarId: gid,
      name: meta.name,
      zh: meta.zh,
      nonce,
      prompt: drill.prompt,
      options: drill.options,
      kind: drill.kind,
    };
  });

  return NextResponse.json({ dueVocab, dueGrammar });
}

export async function POST(req: Request) {
  const body = (await req.json()) as
    | { kind: 'vocab'; id: string; rating: 1 | 2 | 3 | 4 }
    | { kind: 'grammar'; id: string; nonce: number; chosen: number };
  const learner = await ensureLearner();
  const db = getDb();
  const now = new Date();

  if (body.kind === 'vocab') {
    const rows = await db.select().from(vocabStates).where(eq(vocabStates.id, body.id));
    const row = rows[0];
    if (!row || row.learnerId !== learner.id) {
      return NextResponse.json({ error: 'vocab not found' }, { status: 404 });
    }
    const next = review(
      {
        stability: row.stability,
        difficulty: row.difficulty,
        reps: row.reps,
        lapses: row.lapses,
        state: row.fsrsState,
        dueAt: row.dueAt,
      },
      body.rating as SrsRating,
      now,
    );
    const reps = next.reps;
    const wordState =
      next.lapses === 0 && reps >= 5 && next.stability >= 10
        ? 'mastered'
        : reps >= 3
          ? 'review'
          : 'learning';
    await db
      .update(vocabStates)
      .set({
        stability: next.stability,
        difficulty: next.difficulty,
        reps: next.reps,
        lapses: next.lapses,
        state: wordState,
        fsrsState: next.state,
        dueAt: next.dueAt,
      })
      .where(eq(vocabStates.id, body.id));
    const p = { 1: 30, 2: 50, 3: 70, 4: 85 }[body.rating];
    await recordLearningEvidence(learner.id, { skill: 'vocabulary', score: p, source: 'basic_drill' });
    return NextResponse.json({ ok: true, state: wordState });
  }

  // grammar：服务端重算答案，客户端不持答案
  const rows = await db.select().from(grammarStates).where(eq(grammarStates.id, body.id));
  const row = rows[0];
  if (!row || row.learnerId !== learner.id) {
    return NextResponse.json({ error: 'grammar not found' }, { status: 404 });
  }
  const drill = makeDrill(row.grammarId, body.nonce);
  const correct = body.chosen === drill.answer;
  const next = review(
    {
      stability: row.stability,
      difficulty: row.difficulty,
      reps: row.reps,
      lapses: row.lapses,
      state: row.fsrsState,
      dueAt: row.dueAt,
    },
    correct ? 3 : 1,
    now,
  );
  const reps = next.reps;
  const state =
    next.lapses === 0 && reps >= 5 && next.stability >= 10
      ? 'mastered'
      : reps >= 3
        ? 'test'
        : reps >= 1
          ? 'practice'
          : 'exposure';
  await db
    .update(grammarStates)
    .set({
      stability: next.stability,
      difficulty: next.difficulty,
      reps: next.reps,
      lapses: next.lapses,
      state,
      fsrsState: next.state,
      dueAt: next.dueAt,
    })
    .where(eq(grammarStates.id, body.id));
  await recordLearningEvidence(learner.id, { skill: 'grammar', score: correct ? 70 : 30, source: 'basic_drill' });
  if (correct) await resolveLedgerForGrammar(learner.id, row.grammarId); // M3：答对销账
  return NextResponse.json({ ok: true, correct, answer: drill.options[drill.answer], state });
}

export const dynamic = 'force-dynamic';
