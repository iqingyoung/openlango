import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { parseLLMOutput } from './llm-schema.ts';

const schema = z.object({ n: z.number().int().min(0).max(3) });

test('合法输出通过校验', () => {
  assert.deepEqual(parseLLMOutput(schema, '前置说明 {"n":2} 后缀'), { n: 2 });
});

test('schema 不合法返回 null（parse 成功也拒绝）', () => {
  assert.equal(parseLLMOutput(schema, '{"n":99}'), null);
  assert.equal(parseLLMOutput(schema, '{"n":"2"}'), null);
  assert.equal(parseLLMOutput(schema, 'not json'), null);
});

test('截断 JSON 修复后仍须过 schema', () => {
  // 修复出 {"n":2} → 合法
  assert.deepEqual(parseLLMOutput(schema, '{"n":2'), { n: 2 });
  // 修复出 {"n":99} → 校验拒绝
  assert.equal(parseLLMOutput(schema, '{"n":99'), null);
});
