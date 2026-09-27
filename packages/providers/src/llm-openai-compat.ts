/**
 * OpenAI Chat Completions 公分母驱动：一个驱动覆盖 DeepSeek/Qwen/GLM/dots/OpenAI/任意兼容端点。
 * key 从环境变量解析（apiKeyEnv），不落配置文件。
 *
 * 生成调优旋钮（都在 config 驱动位上）：
 *  - temperature / maxTokens：请求未显式指定时的默认值
 *  - extraBody：厂商私有参数直通合并（如 Qwen enable_thinking:false、GLM thinking:{type:"disabled"}、
 *    GPT-5 reasoning_effort:"low"）——关闭思考降低首 token 延迟
 *  - jsonMode:false：厂商不支持 response_format=json_object 时关掉（客户端仍用宽松 JSON 解析兜底）
 *  - stripThink:true：过滤模型把思考过程以内联 <think>...</think> 塞进 content 的情况
 */
import type {
  ChatRequest,
  ChatResponse,
  DriverConfig,
  LLMProvider,
} from '@openlango/core';

export interface OpenAICompatConfig {
  driver: 'openai-compat';
  baseURL: string;
  apiKeyEnv?: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  stripThink?: boolean;
  extraBody?: Record<string, unknown>;
  [key: string]: unknown;
}

function resolveKey(cfg: OpenAICompatConfig): string | undefined {
  if (cfg.apiKey) return cfg.apiKey;
  if (cfg.apiKeyEnv) return process.env[cfg.apiKeyEnv];
  return undefined;
}

/** 组装请求体（纯函数，便于单测）：请求级参数 > 驱动默认值；extraBody 最后直通合并 */
export function buildRequestBody(cfg: OpenAICompatConfig, req: ChatRequest, stream: boolean): string {
  return JSON.stringify({
    model: cfg.model,
    messages: req.messages,
    temperature: req.temperature ?? cfg.temperature,
    max_tokens: req.maxTokens ?? cfg.maxTokens,
    stream,
    ...(req.json && cfg.jsonMode !== false ? { response_format: { type: 'json_object' } } : {}),
    ...cfg.extraBody,
  });
}

/** 跨 chunk 边界剥离内联 <think>...</think> 思考段 */
export class ThinkFilter {
  private buf = '';
  private inThink = false;

  constructor(private enabled: boolean) {}

  push(chunk: string): string {
    if (!this.enabled) return chunk;
    this.buf += chunk;
    let out = '';
    while (this.buf.length > 0) {
      if (this.inThink) {
        const end = this.buf.indexOf('</think>');
        if (end === -1) {
          // 丢弃思考内容，仅保留可能的半截 </think 前缀以防跨块
          const keep = Math.min(this.buf.length, 8);
          this.buf = this.buf.slice(this.buf.length - keep);
          return out;
        }
        this.buf = this.buf.slice(end + 8);
        this.inThink = false;
      } else {
        const start = this.buf.indexOf('<think>');
        if (start === -1) {
          // 保留可能的半截 <think 前缀
          const keep = Math.min(this.buf.length, 7);
          const boundary = this.buf.length - keep;
          out += this.buf.slice(0, boundary);
          this.buf = this.buf.slice(boundary);
          return out;
        }
        out += this.buf.slice(0, start);
        this.buf = this.buf.slice(start + 7);
        this.inThink = true;
      }
    }
    return out;
  }

  end(): string {
    if (!this.enabled) return '';
    const rest = this.inThink ? '' : this.buf;
    this.buf = '';
    return rest;
  }
}

export function createOpenAICompat(raw: DriverConfig): LLMProvider {
  const cfg = raw as unknown as OpenAICompatConfig;
  if (!cfg.baseURL) throw new Error('openai-compat: baseURL required');
  if (!cfg.model) throw new Error('openai-compat: model required');
  const key = resolveKey(cfg);
  const url = `${cfg.baseURL.replace(/\/$/, '')}/chat/completions`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;

  return {
    driver: 'openai-compat',

    async chat(req: ChatRequest): Promise<ChatResponse> {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: buildRequestBody(cfg, req, false),
        signal: req.signal,
      });
      if (!res.ok) {
        throw new Error(`openai-compat ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      let text = data.choices?.[0]?.message?.content ?? '';
      if (cfg.stripThink) text = stripThinkFull(text);
      return {
        text,
        usage: {
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
        },
        finishReason: data.choices?.[0]?.finish_reason,
      };
    },

    async *chatStream(req: ChatRequest): AsyncIterable<string> {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: buildRequestBody(cfg, req, true),
        signal: req.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`openai-compat stream ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const think = new ThinkFilter(cfg.stripThink === true);
      let buf = '';
      let doneFlag = false;
      while (!doneFlag) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (payload === '[DONE]') {
            doneFlag = true;
            break; // 不能直接 return：ThinkFilter 押后的尾巴必须 flush
          }
          try {
            const json = JSON.parse(payload) as {
              choices?: { delta?: { content?: string; reasoning_content?: string } }[];
            };
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              const out = think.push(delta);
              if (out) yield out;
            }
            // delta.reasoning_content（DeepSeek-R1/Qwen 等思考流）静默跳过
          } catch {
            // 跳过不完整帧
          }
        }
      }
      const tail = think.end();
      if (tail) yield tail;
    },
  };
}

/** 非流式整段剥离（含未闭合 <think> 到末尾的情况） */
export function stripThinkFull(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/, '');
}
