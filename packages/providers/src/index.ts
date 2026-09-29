/**
 * Provider 注册表：kind + driver → 实现。接口抽象而非运行时热切换；
 * 新增 provider = 加一个文件 + 在这里注册一行。
 */
import type {
  ASRProvider,
  CapabilityConfig,
  DriverConfig,
  EvaluatorProvider,
  LLMProvider,
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
import { createLLMEvaluator } from './evaluator-llm.ts';

/** kind → provider 接口映射（与 core 冻结接口对齐；realtime M5 接入前不注册，误用编译期即报错） */
interface ProviderForMap {
  llm: LLMProvider;
  search: SearchProvider;
  asr: ASRProvider;
  tts: TTSProvider;
  evaluator: EvaluatorProvider;
}

export type ProviderFor<K extends keyof ProviderForMap> = ProviderForMap[K];

const REGISTRY: { [K in keyof ProviderForMap]: Record<string, (config: DriverConfig) => ProviderForMap[K]> } = {
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
  evaluator: {
    llm: createLLMEvaluator,
  },
};

export function createProvider<K extends keyof ProviderForMap>(
  kind: K,
  config: DriverConfig & { driver: string },
): ProviderFor<K> {
  const factory = REGISTRY[kind][config.driver];
  if (!factory) {
    throw new Error(`no provider registered: ${kind}/${config.driver}`);
  }
  return factory(config);
}

/** 同能力位回退链：主驱动失败自动切换备用（TTS 网络抖动/限流是常态） */
function chainTts(primary: TTSProvider, fallback: TTSProvider): TTSProvider {
  return {
    driver: `${primary.driver}->${fallback.driver}`,
    async synthesize(opts) {
      try {
        return await primary.synthesize(opts);
      } catch (err) {
        console.warn(`[openlango] tts ${primary.driver} 失败，回退 ${fallback.driver}: ${(err as Error).message}`);
        return fallback.synthesize(opts);
      }
    },
  };
}

export interface ProviderSet {
  llm?: ReturnType<typeof createOpenAICompat>;
  search?: SearchProvider;
  asr?: ASRProvider;
  tts?: TTSProvider;
  evaluator?: EvaluatorProvider;
}

/** 配置 → 全部已配置能力位的实例。realtime 驱动按 M5 接入；evaluator 已就绪（llm 驱动）。 */
export function createProviders(config: CapabilityConfig): ProviderSet {
  const out: ProviderSet = {};
  // 动态循环处退化为运行时查表（kind 来自配置文件，编译期无法收窄）
  const factories = REGISTRY as unknown as Record<
    string,
    Record<string, (config: DriverConfig) => unknown>
  >;
  for (const kind of Object.keys(config) as ProviderKind[]) {
    const cfg = config[kind];
    if (!cfg) continue;
    const factory = factories[kind]?.[cfg.driver];
    if (!factory) continue;
    try {
      const primary = factory(cfg);
      // tts 支持可选 fallbackDriver：主驱动失败自动切换（备用配置不全时忽略）
      const fbDriver = typeof cfg.fallbackDriver === 'string' ? cfg.fallbackDriver : null;
      const fallbackFactory = kind === 'tts' && fbDriver ? factories[kind]?.[fbDriver] : undefined;
      if (kind === 'tts' && fbDriver && fallbackFactory) {
        try {
          const fallback = fallbackFactory({ ...cfg, driver: fbDriver }) as TTSProvider;
          (out as Record<string, unknown>)[kind] = chainTts(primary as TTSProvider, fallback);
          continue;
        } catch {
          // 备用驱动配置不全 → 只用主驱动
        }
      }
      (out as Record<string, unknown>)[kind] = primary;
    } catch (err) {
      // 配置不全（如 env 未填）→ 该能力位视为未配置，优雅降级
      console.warn(`[openlango] provider ${kind}/${cfg.driver} skipped: ${(err as Error).message}`);
    }
  }
  return out;
}
