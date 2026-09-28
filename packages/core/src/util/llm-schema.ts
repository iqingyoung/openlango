/**
 * LLM 结构化输出的统一入口：宽松提取（容忍围栏/截断）→ schema 校验。
 * 原则：parse 成功 ≠ 合法；不合法一律返回 null，由调用方决定重试/降级，不让坏数据溜进学习状态。
 */
import type { ZodType } from 'zod';
import { parseJsonLoose } from './json.ts';

export function parseLLMOutput<T>(schema: ZodType<T>, raw: string): T | null {
  let parsed: unknown;
  try {
    parsed = parseJsonLoose(raw);
  } catch {
    return null;
  }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}
