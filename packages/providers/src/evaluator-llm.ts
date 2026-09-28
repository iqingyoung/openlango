/**
 * Evaluator 驱动：把评分能力位落在 openai-compat 端点上。
 * judge/纠错按成本分层用最便宜档；未来接专用评分模型时按同接口替换。
 */
import type {
  DriverConfig,
  EvaluationInput,
  EvaluationResult,
  EvaluatorProvider,
} from '@openlango/core';
import { parseJsonLoose } from '@openlango/core';
import { createOpenAICompat } from './llm-openai-compat.ts';

export function createLLMEvaluator(config: DriverConfig): EvaluatorProvider {
  const llm = createOpenAICompat({ ...config, driver: 'openai-compat' });
  return {
    driver: 'llm',
    async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
      const res = await llm.chat({ json: true, temperature: 0, messages: input.payload });
      let raw: unknown;
      try {
        raw = parseJsonLoose(res.text);
      } catch {
        raw = res.text;
      }
      const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
      const scores: Record<string, number> = {};
      if (obj) {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'number' && Number.isFinite(v)) scores[k] = v;
        }
      }
      return {
        scores: Object.keys(scores).length > 0 ? scores : undefined,
        verdict: obj && typeof obj.verdict === 'string' ? obj.verdict : undefined,
        rationale: obj && typeof obj.rationale === 'string' ? obj.rationale : undefined,
        raw,
      };
    },
  };
}
