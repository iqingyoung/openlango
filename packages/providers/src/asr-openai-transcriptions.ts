/**
 * ASR 驱动：OpenAI /audio/transcriptions 兼容端点。
 * 一个驱动覆盖 Groq（whisper-large-v3-turbo）/ OpenAI / 本地 whisper-asr-webservice 等。
 */
import type { ASRProvider, DriverConfig, Transcript } from '@openlango/core';

export interface OpenAITranscriptionsConfig {
  driver: 'openai-transcriptions';
  baseURL: string;
  apiKeyEnv?: string;
  apiKey?: string;
  model: string;
  language?: string;
  /** 非标路径代理可自定义（默认 audio/transcriptions），如腾讯 MaaS: wand/asrproxy/sync_transcribe */
  path?: string;
  [key: string]: unknown;
}

function resolveKey(cfg: OpenAITranscriptionsConfig): string | undefined {
  if (cfg.apiKey) return cfg.apiKey;
  if (cfg.apiKeyEnv) return process.env[cfg.apiKeyEnv];
  return undefined;
}

const MIME: Record<string, string> = {
  webm: 'audio/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/m4a',
  ogg: 'audio/ogg',
};

export function createOpenAITranscriptions(raw: DriverConfig): ASRProvider {
  const cfg = raw as unknown as OpenAITranscriptionsConfig;
  if (!cfg.baseURL) throw new Error('openai-transcriptions: baseURL required');
  if (!cfg.model) throw new Error('openai-transcriptions: model required');
  const url = `${cfg.baseURL.replace(/\/$/, '')}/${(cfg.path ?? 'audio/transcriptions').replace(/^\//, '')}`;
  const key = resolveKey(cfg);

  return {
    driver: 'openai-transcriptions',

    async transcribe(audio, opts): Promise<Transcript> {
      const format = opts?.format ?? 'webm';
      const bytes = audio instanceof Uint8Array ? audio : new Uint8Array(audio);
      const form = new FormData();
      form.append('file', new Blob([bytes as BlobPart], { type: MIME[format] ?? 'audio/webm' }), `audio.${format}`);
      form.append('model', cfg.model);
      const lang = opts?.language ?? cfg.language;
      if (lang) form.append('language', lang);
      const res = await fetch(url, {
        method: 'POST',
        headers: key ? { authorization: `Bearer ${key}` } : undefined,
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`asr ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { text?: string };
      return { text: data.text ?? '', language: lang };
    },
  };
}
