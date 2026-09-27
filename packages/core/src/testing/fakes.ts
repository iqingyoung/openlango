/** 测试专用假 provider（不进 index 导出） */
import type {
  ChatRequest,
  ChatResponse,
  LLMProvider,
  SearchItem,
  SearchProvider,
} from '../types.ts';

export class FakeLLM implements LLMProvider {
  driver = 'fake' as const;
  calls: ChatRequest[] = [];
  constructor(private responder: (req: ChatRequest, callIndex: number) => string) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const text = this.responder(req, this.calls.length);
    this.calls.push(req);
    return { text };
  }

  async *chatStream(req: ChatRequest): AsyncIterable<string> {
    yield this.responder(req, this.calls.length);
    this.calls.push(req);
  }
}

export class FakeSearch implements SearchProvider {
  driver = 'fake' as const;
  constructor(private items: SearchItem[]) {}

  async search(): Promise<SearchItem[]> {
    return this.items;
  }
}
