import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProvider, createProviders } from './index.ts';
import { interpolate, loadConfig } from './config.ts';

test('注册表：openai-compat 创建', () => {
  const llm = createProvider('llm', {
    driver: 'openai-compat',
    baseURL: 'https://api.example.com/v1',
    model: 'test-model',
  });
  assert.equal(llm.driver, 'openai-compat');
});

test('注册表：ollama 创建', () => {
  const llm = createProvider('llm', { driver: 'ollama', baseURL: 'http://localhost:11434', model: 'qwen3:8b' });
  assert.equal(llm.driver, 'ollama');
});

test('注册表：evaluator/llm 创建（六接口声明与实现对齐）', () => {
  const ev = createProvider('evaluator', {
    driver: 'llm',
    baseURL: 'https://api.example.com/v1',
    model: 'cheap-model',
  });
  assert.equal(ev.driver, 'llm');
  assert.equal(typeof ev.evaluate, 'function');
});

test('注册表：未知 driver 报错', () => {
  assert.throws(() => createProvider('llm', { driver: 'nope' }), /no provider registered/);
});

test('createProviders 只建已注册能力位', () => {
  const out = createProviders({
    llm: { driver: 'ollama', baseURL: 'http://x', model: 'm' },
    search: { driver: 'rss' },
    tts: { driver: 'not-registered-yet' },
  });
  assert.equal(out.llm?.driver, 'ollama');
  assert.equal(out.search?.driver, 'rss');
  assert.equal(out.tts, undefined);
});

test('env 插值：${VAR} 解析', () => {
  const env = { OPENLANGO_TEST_URL: 'https://from-env' };
  assert.equal(interpolate('${OPENLANGO_TEST_URL}/v1', env), 'https://from-env/v1');
  assert.equal(interpolate('plain-value', env), 'plain-value');
  assert.equal(interpolate('${MISSING_VAR}', env), '');
});

test('loadConfig 读根配置并插值', () => {
  process.env.OPENLANGO_LLM_MODEL = 'env-model';
  const cfg = loadConfig(new URL('../../../config/openlango.config.yaml', import.meta.url).pathname);
  assert.equal(cfg.llm?.driver, 'openai-compat');
  assert.equal(cfg.llm?.model, 'env-model');
  assert.equal(cfg.search?.driver, 'rss');
});
