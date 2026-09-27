import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseJsonLoose } from './json.ts';

test('常规解析 + 围栏容忍', () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('```json\n{"a":[1,2]}\n```'), { a: [1, 2] });
  assert.deepEqual(parseJsonLoose('前置说明 {"a":1} 后缀'), { a: 1 });
});

test('截断修复：数组中途截断', () => {
  const truncated = '{"title":"x","quiz":[{"q":"a","options":["a","b"';
  const parsed = parseJsonLoose(truncated) as { title: string; quiz: unknown[] };
  assert.equal(parsed.title, 'x');
  assert.ok(Array.isArray(parsed.quiz));
});

test('截断修复：字符串中途截断', () => {
  const parsed = parseJsonLoose('{"a":"hello wor') as { a: string };
  assert.equal(parsed.a, 'hello wor');
});

test('截断修复：嵌套对象截断', () => {
  const parsed = parseJsonLoose('{"a":{"b":[1,2],"c":"x"},"d":tr') as Record<string, unknown>;
  assert.deepEqual(parsed.a, { b: [1, 2], c: 'x' });
  assert.equal('d' in parsed, false);
});

test('完全无 JSON 报错', () => {
  assert.throws(() => parseJsonLoose('no json here at all'), /no json/);
});
