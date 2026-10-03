'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export interface VoiceMetrics {
  asrMs: number;
  firstTokenMs: number | null;
  firstAudioMs: number | null;
  totalMs: number;
}

interface VoicePanelProps {
  sessionId: string;
  /** 紧凑单行形态：嵌入聊天列（无独立卡片边距） */
  slim?: boolean;
  onUserText: (text: string) => void;
  /** null = 新建助手占位，字符串 = 追加增量 */
  onAssistantDelta: (delta: string | null) => void;
  onAssistantFinal: (opts: {
    corrections?: Array<{ wrong: string; fix: string; note?: string }>;
    error?: string;
    blocked?: boolean;
  }) => void;
}

const RMS_THRESHOLD = 0.02;
/** 打断教练说话要用比回声残留更高的门槛（扬声器漏进麦克风的 AEC 残留） */
const BARGE_RMS_THRESHOLD = 0.05;
/** 播放开始后的回声抑制窗：TTS 起音最响，这段时间不做打断判定 */
const BARGE_SUPPRESS_MS = 500;
const SPEECH_START_FRAMES = 4;
const SPEECH_END_FRAMES = 90; // ~1.5s 静音才算说完（容忍思考停顿）
const BARGE_FRAMES = 10; // ~0.17s 持续出声即打断
const THINK_INTERRUPT_FRAMES = 8; // 思考期开口=取消本轮
const MIN_BLOB_BYTES = 10_000; // <0.5s 的碎片丢弃

type VStatus = 'off' | 'listening' | 'recording' | 'thinking' | 'speaking';

const STATUS_LABEL: Record<VStatus, string> = {
  off: '关闭',
  listening: '🎧 聆听中…（请说话）',
  recording: '🎙 说话中…',
  thinking: '🤔 教练思考中…',
  speaking: '🔊 教练 speaking（开口即打断）',
};

export default function VoicePanel({ sessionId, slim, onUserText, onAssistantDelta, onAssistantFinal }: VoicePanelProps) {
  const [status, setStatus] = useState<VStatus>('off');
  const [metrics, setMetrics] = useState<VoiceMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusRef = useRef<VStatus>('off');
  const setSt = useCallback((s: VStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const speechRef = useRef(0);
  const silenceRef = useRef(0);
  const bargeRef = useRef(0);
  const mimeRef = useRef<string>('audio/webm;codecs=opus');
  const startRecorderRef = useRef<(() => void) | null>(null);
  const speakingSinceRef = useRef(0);

  const playNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      setSt('listening');
      return;
    }
    setSt('speaking');
    speakingSinceRef.current = Date.now(); // 起音抑制窗起点，防扬声器回声自打断
    // base64 → Blob → objectURL：data:audio/mp3 在部分 Edge 版本报"不支持源"，
    // 标准 audio/mpeg + objectURL 兼容性最好
    const bin = atob(next);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      playNext();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      setError(`音频播放失败（code=${audio.error?.code ?? '?'}）`);
      playNext();
    };
    audio
      .play()
      .catch((e: DOMException) => {
        // 不静默跳过：自动播放被拦时要把队列留住并提示
        URL.revokeObjectURL(url);
        if (e.name === 'NotAllowedError') {
          setError('浏览器拦截了自动播放：点击页面任意位置后重试，或检查站点声音权限。');
          queueRef.current.unshift(next); // 放回队首
          setSt('listening');
        } else {
          setError(`播放出错：${e.message}`);
          playNext();
        }
      });
  }, [setSt]);

  /** 打断：取消在途请求、清空播放；capture=true 时立刻进入录音（把用户后半句接住） */
  const bargeIn = useCallback(
    (capture: boolean) => {
      abortRef.current?.abort();
      abortRef.current = null;
      queueRef.current = [];
      if (audioRef.current) {
        audioRef.current.pause();
        // 打断的音频不会走 onended/onerror，objectURL 须显式释放（防长会话内存泄漏）
        if (audioRef.current.src.startsWith('blob:')) URL.revokeObjectURL(audioRef.current.src);
        audioRef.current = null;
      }
      if (capture) {
        speechRef.current = 0;
        silenceRef.current = 0;
        startRecorderRef.current?.();
        setSt('recording');
      } else {
        setSt('listening');
      }
    },
    [setSt],
  );

  const sendTurn = useCallback(
    async (blob: Blob, format: string) => {
      setSt('thinking');
      onAssistantDelta(null);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const form = new FormData();
        form.append('audio', blob, `utterance.${format}`);
        form.append('format', format);
        form.append('sessionId', sessionId);
        const res = await fetch('/api/coach/voice-turn', { method: 'POST', body: form, signal: controller.signal });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          onAssistantFinal({ error: data.error ?? `HTTP ${res.status}` });
          setSt('listening');
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let gotAudio = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split('\n\n');
          buf = frames.pop() ?? '';
          for (const frame of frames) {
            const line = frame.trim();
            if (!line.startsWith('data:')) continue;
            const ev = JSON.parse(line.slice(5).trim()) as {
              type: string;
              text?: string;
              audioBase64?: string;
              nudge?: string;
              message?: string;
              corrections?: Array<{ wrong: string; fix: string; note?: string }>;
              metrics?: VoiceMetrics;
              blocked?: boolean;
            };
            if (ev.type === 'user_transcript' && ev.text) onUserText(ev.text);
            else if (ev.type === 'assistant_transcript' && ev.text) onAssistantDelta(ev.text);
            else if (ev.type === 'assistant_audio' && ev.audioBase64) {
              gotAudio = true;
              queueRef.current.push(ev.audioBase64);
              if (statusRef.current !== 'speaking') playNext();
            } else if (ev.type === 'blocked') {
              onAssistantDelta(ev.nudge ?? '');
              onAssistantFinal({ blocked: true });
              setSt('listening');
            } else if (ev.type === 'error') {
              onAssistantFinal({ error: ev.message });
              setSt('listening');
            } else if (ev.type === 'done') {
              onAssistantFinal({ corrections: ev.corrections });
              if (ev.metrics) setMetrics(ev.metrics);
              if (!gotAudio && statusRef.current === 'thinking') setSt('listening');
            }
          }
        }
        if (statusRef.current === 'thinking') setSt('listening');
      } catch (err) {
        if ((err as Error).name === 'AbortError') return; // barge-in 正常路径
        onAssistantFinal({ error: (err as Error).message });
        setSt('listening');
      }
    },
    [sessionId, onUserText, onAssistantDelta, onAssistantFinal, playNext, setSt],
  );

  const startRecorder = useCallback(() => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
    mimeRef.current = mime || 'audio/webm';
    const rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const type = rec.mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      const fmt = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
      if (blob.size > MIN_BLOB_BYTES) void sendTurn(blob, fmt);
      else setSt('listening');
    };
    recorderRef.current = rec;
    rec.start();
  }, [sendTurn, setSt]);
  startRecorderRef.current = startRecorder;

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    queueRef.current = [];
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
    analyserRef.current = null;
    setSt('off');
  }, [setSt]);

  const loop = useCallback(() => {
    const raf = () => {
      const analyser = analyserRef.current;
      if (!analyser) return;
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.sqrt(sum / data.length);
      const st = statusRef.current;

      if (st === 'listening') {
        speechRef.current = rms > RMS_THRESHOLD ? speechRef.current + 1 : 0;
        if (speechRef.current >= SPEECH_START_FRAMES) {
          speechRef.current = 0;
          silenceRef.current = 0;
          startRecorder();
          setSt('recording');
        }
      } else if (st === 'recording') {
        silenceRef.current = rms < RMS_THRESHOLD ? silenceRef.current + 1 : 0;
        if (silenceRef.current >= SPEECH_END_FRAMES) {
          silenceRef.current = 0;
          recorderRef.current?.state === 'recording' && recorderRef.current.stop();
        }
      } else if (st === 'thinking') {
        // 教练还没出声时用户继续说话 → 取消本轮，直接续录（后半句不丢）
        bargeRef.current = rms > RMS_THRESHOLD ? bargeRef.current + 1 : 0;
        if (bargeRef.current >= THINK_INTERRUPT_FRAMES) {
          bargeRef.current = 0;
          bargeIn(true);
        }
      } else if (st === 'speaking') {
        // 打断门槛高于回声残留 + 起音抑制窗，防自己打断自己
        const inSuppress = Date.now() - speakingSinceRef.current < BARGE_SUPPRESS_MS;
        bargeRef.current = rms > BARGE_RMS_THRESHOLD && !inSuppress ? bargeRef.current + 1 : 0;
        if (bargeRef.current >= BARGE_FRAMES) {
          bargeRef.current = 0;
          bargeIn(true); // 打断并立刻续录
        }
      }
      rafRef.current = requestAnimationFrame(raf);
    };
    rafRef.current = requestAnimationFrame(raf);
  }, [bargeIn, setSt, startRecorder]);

  const start = useCallback(async () => {
    setError(null);
    // getUserMedia 仅存在于安全上下文（https 或 http://localhost）
    if (!navigator.mediaDevices?.getUserMedia) {
      const insecure = !window.isSecureContext;
      setError(
        insecure
          ? '当前页面不是安全上下文，浏览器禁用麦克风。请改用 http://localhost:3000 访问；手机/局域网测试用 pnpm dev:https 后走 https://<IP>:3000（需手动信任自签证书）。'
          : '浏览器不支持 getUserMedia，请更新 Edge/Chrome。',
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const ac = new AudioContext();
      ctxRef.current = ac;
      const src = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      analyserRef.current = analyser;
      void ac.resume(); // 解锁音频输出（自动播放策略）
      setSt('listening');
      loop();
    } catch (err) {
      setError(`麦克风不可用：${(err as Error).message}`);
      stop();
    }
  }, [loop, setSt, stop]);

  useEffect(() => () => stop(), [stop]); // 卸载清理

  const statusRow = (
    <div className="flex flex-wrap items-center gap-3">
      {status === 'off' ? (
        <Button onClick={start} className={slim ? 'px-3 py-1.5 text-[13px]' : ''}>🎤 开启语音模式</Button>
      ) : (
        <Button variant="danger" onClick={stop} className={slim ? 'px-3 py-1.5 text-[13px]' : ''}>⏹ 结束语音</Button>
      )}
      <div className={`text-sm text-muted-foreground ${slim ? 'text-[12px]' : 'min-w-52'}`}>{STATUS_LABEL[status]}</div>
      {slim && metrics && (
        <span className="text-[11px] text-muted-foreground">
          ASR {metrics.asrMs}ms · 首 token {metrics.firstTokenMs ?? '-'}ms · 首音频 {metrics.firstAudioMs ?? '-'}ms
        </span>
      )}
      {error && <div className={`text-[12px] text-danger ${slim ? 'w-full' : ''}`}>{error}</div>}
    </div>
  );

  if (slim) {
    return <div className="shrink-0 rounded-lg border border-border bg-card px-3 py-2">{statusRow}</div>;
  }

  return (
    <Card className="mb-4">
      {statusRow}
      {metrics && (
        <div className="mt-2 inline-block rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          ASR {metrics.asrMs}ms · 首 token {metrics.firstTokenMs ?? '-'}ms · 首音频 {metrics.firstAudioMs ?? '-'}ms · 总 {metrics.totalMs}ms
        </div>
      )}
      {error && <div className="mt-2 text-[13px] text-danger">{error}</div>}
    </Card>
  );
}
