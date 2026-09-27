/**
 * TTS 驱动：OpenAI /audio/speech 兼容端点（OpenAI / Groq playai / 各聚合器 / 自建服务）。
 */
import type { DriverConfig, TTSProvider, TTSResult } from '@openlango/core';

export interface OpenAISpeechConfig {
  driver: 'openai-speech';
  baseURL: string;
  apiKeyEnv?: string;
  apiKey?: string;
  model: string;
  voice?: string; // 默认 alloy
  [key: string]: unknown;
}

export function createOpenAISpeech(raw: DriverConfig): TTSProvider {
  const cfg = raw as unknown as OpenAISpeechConfig;
  if (!cfg.baseURL) throw new Error('openai-speech: baseURL required');
  if (!cfg.model) throw new Error('openai-speech: model required');
  const url = `${cfg.baseURL.replace(/\/$/, '')}/audio/speech`;
  const key = cfg.apiKey ?? (cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : undefined);

  return {
    driver: 'openai-speech',

    async synthesize(text: string, opts?: { voice?: string }): Promise<TTSResult> {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({
          model: cfg.model,
          input: text,
          voice: opts?.voice ?? cfg.voice ?? 'alloy',
          response_format: 'mp3',
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`tts ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { audio: await res.arrayBuffer(), format: 'mp3' };
    },
  };
}
