import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRequestBody, ThinkFilter, stripThinkFull, createOpenAICompat } from './llm-openai-compat.ts';
import type { ChatRequest } from '@openlango/core';

const REQ: ChatRequest = { messages: [{ role: 'user', content: 'hi' }] };

test('请求体：请求级参数优先于驱动默认值', () => {
  const body = JSON.parse(
    buildRequestBody({ driver: 'openai-compat', baseURL: 'x', model: 'm', temperature: 0.7, maxTokens: 100 },
      { ...REQ, temperature: 0.2, maxTokens: 50 }, false),
  );
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 50);
  assert.equal(body.stream, false);
});

test('请求体：驱动默认值兜底', () => {
  const body = JSON.parse(
    buildRequestBody({ driver: 'openai-compat', baseURL: 'x', model: 'm', temperature: 0.9, maxTokens: 300 }, REQ, true),
  );
  assert.equal(body.temperature, 0.9);
  assert.equal(body.max_tokens, 300);
  assert.equal(body.stream, true);
});

test('请求体：extraBody 直通合并（厂商思考开关）', () => {
  const body = JSON.parse(
    buildRequestBody({ driver: 'openai-compat', baseURL: 'x', model: 'm', extraBody: { enable_thinking: false, top_k: 5 } }, REQ, false),
  );
  assert.equal(body.enable_thinking, false);
  assert.equal(body.top_k, 5);
});

test('请求体：jsonMode=false 时不发 response_format', () => {
  const on = JSON.parse(buildRequestBody({ driver: 'openai-compat', baseURL: 'x', model: 'm' }, { ...REQ, json: true }, false));
  assert.deepEqual(on.response_format, { type: 'json_object' });
  const off = JSON.parse(buildRequestBody({ driver: 'openai-compat', baseURL: 'x', model: 'm', jsonMode: false }, { ...REQ, json: true }, false));
  assert.equal(off.response_format, undefined);
});

test('ThinkFilter：跨 chunk 边界剥离 <think>', () => {
  const f = new ThinkFilter(true);
  const out = [f.push('<th'), f.push('ink>hidden '), f.push('secret</th'), f.push('ink>visi'), f.push('ble'), f.end()].join('');
  assert.equal(out, 'visible');
});

test('ThinkFilter：未闭合 think 到末尾全部丢弃', () => {
  const f = new ThinkFilter(true);
  const out = [f.push('answer<think>hmm'), f.push(' still thinking'), f.end()].join('');
  assert.equal(out, 'answer');
});

test('ThinkFilter：关闭时原样透传', () => {
  const f = new ThinkFilter(false);
  assert.equal(f.push('<think>x</think>ok'), '<think>x</think>ok');
});

test('ThinkFilter：短回复押后字符必须由 end() 释放（[DONE] flush 回归）', () => {
  const f = new ThinkFilter(true);
  assert.equal(f.push('OK'), ''); // 单 delta 短于 7 字符时押后
  assert.equal(f.end(), 'OK');
});

test('stripThinkFull：整段剥离', () => {
  assert.equal(stripThinkFull('<think>a</think>hello'), 'hello');
  assert.equal(stripThinkFull('hi<think>never closed'), 'hi');
});

test('注册表：缺 baseURL 报错（配置不全优雅降级的前置）', () => {
  assert.throws(() => createOpenAICompat({ driver: 'openai-compat', model: 'm' }), /baseURL required/);
});
