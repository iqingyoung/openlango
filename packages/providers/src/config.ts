/** YAML 配置加载：${VAR} 从环境变量解析，key 永远走 env 不落盘 */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { OpenLangoConfig } from '@openlango/core';

export function interpolate(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => env[name] ?? '');
}

function deepInterpolate(node: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof node === 'string') return interpolate(node, env);
  if (Array.isArray(node)) return node.map((v) => deepInterpolate(v, env));
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = deepInterpolate(v, env);
    return out;
  }
  return node;
}

export function loadConfig(path: string, env: NodeJS.ProcessEnv = process.env): OpenLangoConfig {
  const raw = readFileSync(path, 'utf8');
  return deepInterpolate(parse(raw), env) as OpenLangoConfig;
}
