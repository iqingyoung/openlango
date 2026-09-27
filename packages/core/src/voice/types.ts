/**
 * 语音回合事件流（cascade | realtime 共用的事件词汇）。
 * 设计原则：管道每步可观测（metrics 上报各阶段耗时）；
 * barge-in 由客户端触发（打断播放 + abort fetch），服务端通过 req.signal 级联取消。
 */
import type { TurnJudge } from '../coach/index.ts';

export type VoiceEvent =
  | { type: 'user_transcript'; text: string; asrMs: number }
  | { type: 'assistant_transcript'; text: string }
  | { type: 'assistant_audio'; audioBase64: string; sentence: string }
  | { type: 'blocked'; nudge: string }
  | { type: 'error'; message: string }
  | {
      type: 'done';
      reply: string;
      blocked?: boolean;
      metrics: VoiceTurnMetrics;
      corrections?: Array<{ wrong: string; fix: string; note?: string }>;
      /** 完整 judge 结果（服务端落信号用；客户端可忽略） */
      judge?: TurnJudge;
    };

export interface VoiceTurnMetrics {
  asrMs: number;
  firstTokenMs: number | null;
  firstAudioMs: number | null;
  totalMs: number;
}

/** 把 LLM 流式文本切成 TTS 句子：短片段并入下一句，超长句按逗号硬切 */
export function splitSentences(text: string, opts?: { minChars?: number; maxChars?: number }): string[] {
  const minChars = opts?.minChars ?? 12;
  const maxChars = opts?.maxChars ?? 220;
  // 标点后跟空白/汉字/结尾才切（保护 e.g.、3.5）；用 match 提取（零宽 split 在转译环境下不可靠）
  const out: string[] = [];
  const re = /[\s\S]*?[.!?。！？](?=\s|$|[\u4e00-\u9fff])/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0].trim());
    last = m.index + m[0].length;
  }
  const tail = text.slice(last).trim();
  if (tail) out.push(tail);
  const pieces = out.filter(Boolean);
  const merged: string[] = [];
  for (const piece of pieces) {
    if (piece.length > maxChars) {
      // 按逗号硬切
      let buf = '';
      for (const part of piece.split(/(?<=[,;，；])\s*/)) {
        if ((buf + part).length > maxChars && buf) {
          merged.push(buf.trim());
          buf = part;
        } else {
          buf += part;
        }
      }
      if (buf.trim()) merged.push(buf.trim());
      continue;
    }
    const prev = merged[merged.length - 1];
    if (prev !== undefined && prev.length < minChars) {
      merged[merged.length - 1] = `${prev} ${piece}`;
    } else {
      merged.push(piece);
    }
  }
  return merged;
}
