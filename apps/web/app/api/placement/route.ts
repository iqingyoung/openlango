import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { ensureLearner, getBands, getDb } from '@/lib/server';
import {
  learners,
  placementRuns,
  skillLevels,
  PlacementEngine,
  nextPlacementItem,
  mulberry32,
  type PlacementItem,
  type PlacementState,
} from '@openlango/core';

interface RunState {
  engine: PlacementState;
  lastItem: PlacementItem | null;
  done: boolean;
}

export async function POST(req: Request) {
  const body = (await req.json()) as
    | { action: 'start' }
    | { action: 'answer'; runId: string; chosen: number };
  const learner = await ensureLearner();
  const db = getDb();

  if (body.action === 'start') {
    const engine = new PlacementEngine();
    const runId = crypto.randomUUID();
    const rng = mulberry32(engine.seed ^ Date.now());
    const state: RunState = { engine: engine.serialize(), lastItem: null, done: false };
    const item = nextPlacementItem(engine, state.engine, rng);
    state.lastItem = item;
    state.engine = engine.serialize();
    await db.insert(placementRuns).values({
      id: runId,
      learnerId: learner.id,
      mode: 'placement',
      resultJson: JSON.stringify(state),
    });
    return NextResponse.json({
      runId,
      item: { prompt: item.prompt, options: item.options, kind: item.kind },
      progress: 0,
    });
  }

  // answer
  const rows = await db.select().from(placementRuns).where(eq(placementRuns.id, body.runId));
  const run = rows[0];
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  const state = JSON.parse(run.resultJson) as RunState;
  if (state.done || !state.lastItem) {
    return NextResponse.json({ error: 'run already finished' }, { status: 400 });
  }
  const engine = PlacementEngine.from(state.engine);
  const rng = mulberry32((engine.seed ^ (engine.count * 2654435761)) >>> 0);
  const correct = body.chosen === state.lastItem.answer;
  engine.record(state.lastItem.difficulty, correct);

  if (engine.finished) {
    const result = engine.result();
    // 五维落库（placement 结果覆盖初值）+ 清除再校准标记
    await db.update(learners).set({ recalibrateAt: null }).where(eq(learners.id, learner.id));
    for (const [skill, theta] of Object.entries(result.vector)) {
      await db
        .insert(skillLevels)
        .values({
          learnerId: learner.id,
          skill,
          theta,
          confidence: result.confidence[skill as keyof typeof result.confidence] ?? 0,
          ewma: theta,
        })
        .onConflictDoUpdate({
          target: [skillLevels.learnerId, skillLevels.skill],
          set: {
            theta,
            confidence: result.confidence[skill as keyof typeof result.confidence] ?? 0,
            ewma: theta,
            updatedAt: new Date(),
          },
        });
    }
    state.done = true;
    state.engine = engine.serialize();
    state.lastItem = null;
    await db
      .update(placementRuns)
      .set({ resultJson: JSON.stringify(state) })
      .where(eq(placementRuns.id, body.runId));
    const bands = await getBands(learner.id);
    return NextResponse.json({ finished: true, bands, basis: result.basis, correct });
  }

  const item = nextPlacementItem(engine, state.engine, rng);
  state.lastItem = item;
  state.engine = engine.serialize();
  await db
    .update(placementRuns)
    .set({ resultJson: JSON.stringify(state) })
    .where(eq(placementRuns.id, body.runId));
  return NextResponse.json({
    finished: false,
    correct,
    item: { prompt: item.prompt, options: item.options, kind: item.kind },
    progress: engine.count,
  });
}

export const dynamic = 'force-dynamic';
