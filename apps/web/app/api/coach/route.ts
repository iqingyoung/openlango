import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import {
  ensureLearner,
  getLlm,
  getEvaluator,
  getDb,
  loadSkillStates,
  recordLearningEvidence,
  getGenerationParams,
  getLastTurnDrift,
  insertLedgerRows,
  auditTurn,
  checkRecalibration,
} from '@/lib/server';
import {
  sessions,
  turns,
  classifyInput,
  generateScenario,
  judgeTurn,
  signalsFromJudge,
  renderSystemPrompt,
  scenarioBrief,
  wrapUserContent,
  bandOf,
  type ChatMessage,
  type Scenario,
} from '@openlango/core';

/** 恢复历史会话：仪表盘「继续练习」直达（GET /api/coach?resume=<sessionId>） */
export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get('resume');
  if (!sessionId) return NextResponse.json({ error: 'resume 参数缺失' }, { status: 400 });
  const db = getDb();
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session?.scenarioJson) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  const prevTurns = await db.select().from(turns).where(eq(turns.sessionId, sessionId)).orderBy(asc(turns.idx));
  const messages: ChatMessage[] = [];
  for (const t of prevTurns) {
    if (t.userText) messages.push({ role: 'user', content: t.userText });
    if (t.assistantText) messages.push({ role: 'assistant', content: t.assistantText });
  }
  return NextResponse.json({
    sessionId,
    scenario: JSON.parse(session.scenarioJson) as Scenario,
    messages,
    ended: session.endedAt !== null && session.endedAt !== undefined,
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as
    | { action: 'scenario'; interest: string }
    | { action: 'turn'; sessionId: string; text: string }
    | { action: 'end'; sessionId: string };
  const learner = await ensureLearner();
  const db = getDb();
  const llm = getLlm();
  const vectorState = await loadSkillStates(learner.id);
  const vector = {
    reading: vectorState.reading.theta,
    listening: vectorState.listening.theta,
    speaking: vectorState.speaking.theta,
    vocabulary: vectorState.vocabulary.theta,
    grammar: vectorState.grammar.theta,
  };

  // 结束会话：落库 endedAt（仪表盘「继续练习」据此隐藏已结束会话）
  if (body.action === 'end') {
    await db.update(sessions).set({ endedAt: new Date() }).where(eq(sessions.id, body.sessionId));
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'scenario') {
    const gen = getGenerationParams('scenario');
    const { scenario, source } = await generateScenario({
      interest: body.interest,
      vector,
      llm: llm ?? undefined,
      temperature: gen.temperature,
      maxTokens: gen.maxTokens,
    });
    const sessionId = crypto.randomUUID();
    await db.insert(sessions).values({
      id: sessionId,
      learnerId: learner.id,
      module: 'coach',
      scenarioJson: JSON.stringify(scenario),
    });
    return NextResponse.json({ sessionId, scenario, source });
  }

  // turn：guard 前置（block 走 JSON 短路，不建流）
  if (!llm) {
    return NextResponse.json({ error: 'LLM 未配置（检查 .env 与 config/openlango.config.yaml）' }, { status: 503 });
  }
  const verdict = classifyInput(body.text, 'coach');
  if (verdict.action === 'block') {
    return NextResponse.json({ blocked: true, nudge: NUDGE_EN, category: verdict.category });
  }

  const sessRows = await db.select().from(sessions).where(eq(sessions.id, body.sessionId));
  const session = sessRows[0];
  if (!session?.scenarioJson) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  const scenario = JSON.parse(session.scenarioJson) as Scenario;
  const prevTurns = await db
    .select()
    .from(turns)
    .where(eq(turns.sessionId, session.id))
    .orderBy(asc(turns.idx));
  const history: ChatMessage[] = [];
  for (const t of prevTurns.slice(-10)) {
    if (t.userText) history.push({ role: 'user', content: t.userText });
    if (t.assistantText) history.push({ role: 'assistant', content: t.assistantText });
  }
  const cefr = bandOf(vector.speaking);
  const gen = getGenerationParams('coach');
  const judgeGen = getGenerationParams('judge');
  // M3：上一轮漂移 → 本轮 system 加固
  const drift = await getLastTurnDrift(body.sessionId);
  const hardening =
    drift?.drifted && drift.reasons.length > 0
      ? `\nRole hardening: your previous reply drifted from the coach role (${drift.reasons.join('; ')}). Strictly follow the Core Policy this turn.`
      : '';

  // SSE 流式：delta 增量 → done → corrections（judge 在正文后跑，不挡首 token）
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      let full = '';
      try {
        for await (const delta of llm.chatStream({
          temperature: gen.temperature ?? 0.7,
          maxTokens: gen.maxTokens,
          messages: [
            {
              role: 'system',
              content: renderSystemPrompt({
                module: 'coach',
                task: scenarioBrief(scenario) + hardening,
                learnerState: `speaking: ${cefr}; vocabulary: ${bandOf(vector.vocabulary)}`,
              }),
            },
            ...history,
            { role: 'user', content: wrapUserContent(body.text) },
          ],
        })) {
          full += delta;
          send({ type: 'delta', text: delta });
        }
        send({ type: 'done' });

        const judge = await judgeTurn({
          text: body.text,
          reply: full,
          scenario,
          vector,
          llm,
          evaluator: getEvaluator() ?? undefined,
          maxTokens: judgeGen.maxTokens,
        });
        const idx = prevTurns.length;
        const turnId = crypto.randomUUID();
        await db.insert(turns).values({
          id: turnId,
          sessionId: session.id,
          idx,
          userText: body.text,
          assistantText: full,
          metaJson: judge ? JSON.stringify({ judge }) : null,
        });
        if (judge) send({ type: 'corrections', corrections: judge.corrections });
        // M3 异步审计 pass：不挡响应
        void (async () => {
          try {
            if (judge) {
              await insertLedgerRows(learner.id, session.id, judge);
              const sig = signalsFromJudge(judge);
              if (typeof sig.speaking === 'number')
                await recordLearningEvidence(learner.id, { skill: 'speaking', score: sig.speaking, source: 'coach_judge' });
              if (typeof sig.vocabulary === 'number')
                await recordLearningEvidence(learner.id, { skill: 'vocabulary', score: sig.vocabulary, source: 'coach_judge' });
            }
            await auditTurn({ turnId, reply: full, scenario, llm });
            await checkRecalibration(learner.id);
          } catch {
            // 审计失败静默
          }
        })();
      } catch (err) {
        send({ type: 'error', message: `LLM 调用失败：${(err as Error).message.slice(0, 300)}` });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
  });
}

const NUDGE_EN =
  "Let's keep practicing English! I'm your coach and that can't change — but I can play any scene you like. What would you like to practice?";

export const dynamic = 'force-dynamic';
