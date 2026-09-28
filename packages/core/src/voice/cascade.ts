/**
 * Cascade 语音回合编排（纯逻辑，provider 注入，可全链路假件测试）：
 * ASR → guard（劫持短路）→ 流式 LLM → 分句流式 TTS → judge/metrics。
 * barge-in：调用方传 abort signal，本编排在阶段间与流内检查后尽快退出；
 * abort 以 done（blocked:false）收尾，不算错误。
 * 每步耗时都进 metrics（管道可观测验收）。
 */
import type { ASRProvider, ChatMessage, EvaluatorProvider, LLMProvider, TTSProvider } from '../types.ts';
import { classifyInput } from '../guard/index.ts';
import { splitSentences } from './types.ts';
import type { VoiceEvent, VoiceTurnMetrics } from './types.ts';
import { judgeTurn, NUDGE_EN, type Scenario, type TurnJudge } from '../coach/index.ts';

export type { VoiceEvent, VoiceTurnMetrics };

export interface CascadeTurnOptions {
  audio: ArrayBuffer | Uint8Array;
  audioFormat?: string;
  /** 已组装好的 harness system + history（不含本轮 user 内容） */
  messages: ChatMessage[];
  scenario: Scenario;
  /** judge 用的两维等级（conversation 只关心口语/词汇） */
  vector: { speaking: number; vocabulary: number };
  llm: LLMProvider;
  /** 独立评分通道（可选）；缺省时 judge 用 llm */
  evaluator?: EvaluatorProvider;
  asr: ASRProvider;
  tts?: TTSProvider;
  voice?: string;
  temperature?: number;
  maxTokens?: number;
  judgeMaxTokens?: number;
  signal?: AbortSignal;
}

export async function* cascadeVoiceTurn(opts: CascadeTurnOptions): AsyncGenerator<VoiceEvent> {
  const t0 = Date.now();
  const metrics: VoiceTurnMetrics = { asrMs: 0, firstTokenMs: null, firstAudioMs: null, totalMs: 0 };
  const throwIfAborted = () => {
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
  };

  // 合成一句（返回事件，由生成器体 yield；串行调用即保序）。
  // 单句 15s 超时：TTS 故障时降级为纯文本，不挂死回合。
  const synthSentence = async (sentence: string): Promise<VoiceEvent | null> => {
    if (!opts.tts || !sentence.trim()) return null;
    throwIfAborted();
    const synth = opts.tts.synthesize(sentence, { voice: opts.voice });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), 15_000);
    });
    try {
      const audio = await Promise.race([synth, timeout]);
      if (!audio) return null;
      if (metrics.firstAudioMs === null) metrics.firstAudioMs = Date.now() - t0;
      return {
        type: 'assistant_audio',
        audioBase64: Buffer.from(audio.audio).toString('base64'),
        sentence,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  try {
    // 1) ASR
    throwIfAborted();
    const transcript = await opts.asr.transcribe(opts.audio, {
      language: 'en',
      format: opts.audioFormat ?? 'webm',
    });
    metrics.asrMs = Date.now() - t0;

    // 空转写（回声/噪声被录进去）→ 直接结束，不调 LLM、不落库，防自打断反馈环
    if (!transcript.text.trim()) {
      yield {
        type: 'done',
        reply: '',
        metrics: { ...metrics, totalMs: Date.now() - t0 },
      };
      return;
    }
    yield { type: 'user_transcript', text: transcript.text, asrMs: metrics.asrMs };

    // 2) guard：劫持短路（不调 LLM/TTS）
    const verdict = classifyInput(transcript.text, 'coach');
    if (verdict.action === 'block') {
      yield { type: 'blocked', nudge: NUDGE_EN };
      yield {
        type: 'done',
        reply: NUDGE_EN,
        blocked: true,
        metrics: { ...metrics, totalMs: Date.now() - t0 },
      };
      return;
    }

    // 3) 流式 LLM + 分句流式 TTS
    throwIfAborted();
    const messages: ChatMessage[] = [...opts.messages, { role: 'user', content: transcript.text }];
    let reply = '';
    let pendingText = '';

    for await (const delta of opts.llm.chatStream({
      messages,
      temperature: opts.temperature ?? 0.7,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
    })) {
      if (opts.signal?.aborted) break;
      if (metrics.firstTokenMs === null) metrics.firstTokenMs = Date.now() - t0;
      reply += delta;
      yield { type: 'assistant_transcript', text: delta };
      pendingText += delta;
      // 句末标点（后跟空白/汉字/结尾）即边界，逐句送 TTS（串行保序）
      let idx: number;
      while ((idx = pendingText.search(/[.!?。！？](?=\s|$|[\u4e00-\u9fff])/)) !== -1) {
        const sentence = pendingText.slice(0, idx + 1).trim();
        pendingText = pendingText.slice(idx + 1).trimStart();
        if (sentence) {
          const ev = await synthSentence(sentence);
          if (ev) yield ev;
        }
      }
    }
    throwIfAborted();
    // 收尾：剩余文本（超长按 maxChars 硬切）
    const rest = pendingText.trim();
    if (rest) {
      for (const s of splitSentences(rest, { minChars: 9999, maxChars: 220 })) {
        const ev = await synthSentence(s);
        if (ev) yield ev;
      }
    }
    metrics.totalMs = Date.now() - t0;

    // 4) judge（不阻塞音频回放，文本完成后跑）
    let judge: TurnJudge | null = null;
    try {
      judge = await judgeTurn({
        evaluator: opts.evaluator,
        text: transcript.text,
        reply,
        scenario: opts.scenario,
        vector: opts.vector,
        llm: opts.llm,
        maxTokens: opts.judgeMaxTokens,
      });
    } catch {
      judge = null;
    }

    yield { type: 'done', reply, metrics, corrections: judge?.corrections ?? undefined, judge: judge ?? undefined };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      metrics.totalMs = Date.now() - t0;
      yield { type: 'done', reply: '', metrics, blocked: false };
      return;
    }
    yield { type: 'error', message: `语音回合失败：${(err as Error).message.slice(0, 300)}` };
  }
}
