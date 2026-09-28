import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import {
  ensureLearner,
  getLlm,
  getAsr,
  getTts,
  getDb,
  loadSkillStates,
  recordLearningEvidence,
  getGenerationParams,
  insertLedgerRows,
  auditTurn,
  checkRecalibration,
} from '@/lib/server';
import {
  sessions,
  turns,
  renderSystemPrompt,
  scenarioBrief,
  wrapUserContent,
  bandOf,
  cascadeVoiceTurn,
  signalsFromJudge,
  type ChatMessage,
  type Scenario,
  type TurnJudge,
  type VoiceEvent,
} from '@openlango/core';

/** cascade 语音回合：multipart(audio, format, sessionId) → SSE(VoiceEvent) */
export async function POST(req: Request) {
  const form = await req.formData();
  const audioBlob = form.get('audio');
  const sessionId = form.get('sessionId');
  const format = String(form.get('format') ?? 'webm');
  if (!(audioBlob instanceof Blob) || typeof sessionId !== 'string') {
    return NextResponse.json({ error: '缺少 audio 或 sessionId' }, { status: 400 });
  }

  const llm = getLlm();
  const asr = getAsr();
  const tts = getTts();
  if (!llm) return NextResponse.json({ error: 'LLM 未配置' }, { status: 503 });
  if (!asr) return NextResponse.json({ error: 'ASR 未配置：在 .env 填 OPENLANGO_ASR_API_KEY（Groq 免费档即可）后重启' }, { status: 503 });

  const learner = await ensureLearner();
  const db = getDb();
  const sessRows = await db.select().from(sessions).where(eq(sessions.id, sessionId));
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
  const vectorState = await loadSkillStates(learner.id);
  const vector = {
    reading: vectorState.reading.theta,
    listening: vectorState.listening.theta,
    speaking: vectorState.speaking.theta,
    vocabulary: vectorState.vocabulary.theta,
    grammar: vectorState.grammar.theta,
  };
  const gen = getGenerationParams('coach');
  const judgeGen = getGenerationParams('judge');
  const audio = new Uint8Array(await audioBlob.arrayBuffer());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: VoiceEvent) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      let transcript = '';
      let reply = '';
      let judge: TurnJudge | undefined;
      try {
        for await (const ev of cascadeVoiceTurn({
          audio,
          audioFormat: format,
          messages: [
            {
              role: 'system',
              content: renderSystemPrompt({
                module: 'coach',
                task: scenarioBrief(scenario),
                learnerState: `speaking: ${bandOf(vector.speaking)}; vocabulary: ${bandOf(vector.vocabulary)}`,
              }),
            },
            ...history,
          ],
          scenario,
          vector: { speaking: vector.speaking, vocabulary: vector.vocabulary },
          llm,
          asr,
          tts: tts ?? undefined,
          voice: undefined,
          temperature: gen.temperature,
          maxTokens: gen.maxTokens,
          judgeMaxTokens: judgeGen.maxTokens,
          signal: req.signal,
        })) {
          if (ev.type === 'user_transcript') transcript = ev.text;
          if (ev.type === 'assistant_transcript') reply += ev.text;
          if (ev.type === 'done') judge = ev.judge;
          send(ev);
        }
        // 落库 + 信号（空转写=回声幻影，不落库不算轮次）
        if (transcript.trim()) {
          const idx = prevTurns.length;
          const turnId = crypto.randomUUID();
          await db.insert(turns).values({
            id: turnId,
            sessionId: session.id,
            idx,
            userText: transcript || null,
            assistantText: reply || null,
            metaJson: judge ? JSON.stringify({ judge }) : null,
          });
          // M3 异步审计 pass：不挡音频
          void (async () => {
            try {
              if (judge) {
                await insertLedgerRows(learner.id, session.id, judge);
                const sig = signalsFromJudge(judge);
                if (typeof sig.speaking === 'number')
                  await recordLearningEvidence(learner.id, { skill: 'speaking', score: sig.speaking, source: 'voice_judge' });
                if (typeof sig.vocabulary === 'number')
                  await recordLearningEvidence(learner.id, { skill: 'vocabulary', score: sig.vocabulary, source: 'voice_judge' });
              }
              await auditTurn({ turnId, reply, scenario, llm });
              await checkRecalibration(learner.id);
            } catch {
              // 静默
            }
          })();
        }
      } catch (err) {
        send({ type: 'error', message: `语音回合失败：${(err as Error).message.slice(0, 300)}` });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
  });
}

export const dynamic = 'force-dynamic';
