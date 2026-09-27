/**
 * Provider 注册表：kind + driver → 实现。接口抽象而非运行时热切换；
 * 新增 provider = 加一个文件 + 在这里注册一行。
 */
import type {
  ASRProvider,
  CapabilityConfig,
  DriverConfig,
  ProviderKind,
  SearchProvider,
  TTSProvider,
} from '@openlango/core';
import { createOpenAICompat } from './llm-openai-compat.ts';
import { createOllama } from './llm-ollama.ts';
import { createRssSearch } from './search-rss.ts';
import { createOpenAITranscriptions } from './asr-openai-transcriptions.ts';
import { createMsEdgeTTS } from './tts-msedge.ts';
import { createOpenAISpeech } from './tts-openai-speech.ts';

const REGISTRY: Record<string, Record<string, (config: DriverConfig) => unknown>> = {
  llm: {
    'openai-compat': createOpenAICompat,
    ollama: createOllama,
  },
  search: {
    rss: createRssSearch,
  },
  asr: {
    'openai-transcriptions': createOpenAITranscriptions,
  },
  tts: {
    msedge: createMsEdgeTTS,
    'openai-speech': createOpenAISpeech,
  },
};

export function createProvider(kind: ProviderKind, config: DriverConfig): unknown {
  const table = REGISTRY[kind];
  const factory = table?.[config.driver];
  if (!factory) {
    throw new Error(`no provider registered: ${kind}/${config.driver}`);
  }
  return factory(config);
}

export interface ProviderSet {
  llm?: ReturnType<typeof createOpenAICompat>;
  search?: SearchProvider;
  asr?: ASRProvider;
  tts?: TTSProvider;
}

/** 配置 → 全部已配置能力位的实例。realtime/evaluator 按计划 M4 接入。 */
export function createProviders(config: CapabilityConfig): ProviderSet {
  const out: ProviderSet = {};
  for (const kind of Object.keys(config) as ProviderKind[]) {
    const cfg = config[kind];
    if (!cfg) continue;
    if (!REGISTRY[kind]?.[cfg.driver]) continue;
    try {
      (out as Record<string, unknown>)[kind] = createProvider(kind, cfg);
    } catch (err) {
      // 配置不全（如 env 未填）→ 该能力位视为未配置，优雅降级
      console.warn(`[openlango] provider ${kind}/${cfg.driver} skipped: ${(err as Error).message}`);
    }
  }
  return out;
}
