/** Ollama 本地驱动（零成本路径） */
import type { ChatRequest, ChatResponse, DriverConfig, LLMProvider } from '@openlango/core';

export interface OllamaConfig {
  driver: 'ollama';
  baseURL: string;
  model: string;
  [key: string]: unknown;
}

export function createOllama(raw: DriverConfig): LLMProvider {
  const cfg = raw as unknown as OllamaConfig;
  if (!cfg.baseURL) throw new Error('ollama: baseURL required');
  if (!cfg.model) throw new Error('ollama: model required');
  const url = `${cfg.baseURL.replace(/\/$/, '')}/api/chat`;

  function body(req: ChatRequest, stream: boolean) {
    return JSON.stringify({
      model: cfg.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream,
      ...(req.json ? { format: 'json' } : {}),
      options: {
        temperature: req.temperature,
        ...(req.maxTokens ? { num_predict: req.maxTokens } : {}),
      },
    });
  }

  return {
    driver: 'ollama',

    async chat(req: ChatRequest): Promise<ChatResponse> {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body(req, false),
        signal: req.signal,
      });
      if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      return {
        text: data.message?.content ?? '',
        usage: {
          promptTokens: data.prompt_eval_count,
          completionTokens: data.eval_count,
        },
      };
    },

    async *chatStream(req: ChatRequest): AsyncIterable<string> {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body(req, true),
        signal: req.signal,
      });
      if (!res.ok || !res.body) throw new Error(`ollama stream ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          try {
            const json = JSON.parse(t) as {
              message?: { content?: string };
              done?: boolean;
            };
            if (json.message?.content) yield json.message.content;
            if (json.done) return;
          } catch {
            // 跳过不完整帧
          }
        }
      }
    },
  };
}
