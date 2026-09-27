/**
 * OpenLango Provider 接口（M0 冻结）。
 * 六个能力位：llm / asr / tts / realtime / search / evaluator。
 * 原则：接口抽象而非运行时热切换；模型可换，学习状态持久。
 */

// ---------- LLM ----------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 请求 JSON 输出（provider 尽力支持） */
  json?: boolean;
  signal?: AbortSignal;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface ChatResponse {
  text: string;
  usage?: ChatUsage;
  /** 'stop' | 'length' | ...；'length' = 被 max_tokens 截断（JSON 输出会残缺） */
  finishReason?: string;
}

export interface LLMProvider {
  readonly driver: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
  chatStream(req: ChatRequest): AsyncIterable<string>;
}

// ---------- ASR ----------

export interface Transcript {
  text: string;
  language?: string;
  confidence?: number;
}

export interface ASRProvider {
  readonly driver: string;
  transcribe(
    audio: ArrayBuffer | Uint8Array,
    opts?: { language?: string; format?: string },
  ): Promise<Transcript>;
}

// ---------- TTS ----------

export interface TTSOptions {
  voice?: string;
  speed?: number;
  format?: string;
}

export interface TTSResult {
  audio: ArrayBuffer;
  format: string;
}

export interface TTSProvider {
  readonly driver: string;
  synthesize(text: string, opts?: TTSOptions): Promise<TTSResult>;
}

// ---------- Realtime（语音到语音） ----------

export type RealtimeEvent =
  | { type: 'user_speech_start' }
  | { type: 'user_transcript'; text: string }
  | { type: 'assistant_transcript'; text: string }
  | { type: 'assistant_audio'; audio: ArrayBuffer }
  | { type: 'error'; message: string };

export interface RealtimeSession {
  sendAudio(chunk: ArrayBuffer): void;
  sendText?(text: string): void;
  commit?(): void;
  readonly events: AsyncIterable<RealtimeEvent>;
  close(): Promise<void>;
}

export interface RealtimeConnectOptions {
  /** 服务端组装好的 harness system prompt（含等级门控），客户端不可篡改 */
  instructions: string;
  voice?: string;
  signal?: AbortSignal;
}

export interface RealtimeProvider {
  readonly driver: string;
  connect(opts: RealtimeConnectOptions): Promise<RealtimeSession>;
}

// ---------- Search ----------

export interface SearchItem {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source?: string;
  /** 命中所属话题（多话题搜索时由 searchTopics 标注） */
  topic?: string;
}

export type SearchFreshness = 'day' | 'week' | 'month';

export interface SearchProvider {
  readonly driver: string;
  search(
    query: string,
    opts?: { limit?: number; freshness?: SearchFreshness },
  ): Promise<SearchItem[]>;
}

// ---------- Evaluator（judge，独立接口：可接专用评分模型） ----------

export type EvaluationKind = 'placement_item' | 'turn' | 'session' | 'article_quiz';

export interface EvaluationInput {
  kind: EvaluationKind;
  /** 由调用方组装好的 judge prompt（含 rubric），含 learner state */
  payload: ChatRequest['messages'];
}

export interface EvaluationResult {
  scores?: Record<string, number>;
  verdict?: string;
  rationale?: string;
  raw?: unknown;
}

export interface EvaluatorProvider {
  readonly driver: string;
  evaluate(input: EvaluationInput): Promise<EvaluationResult>;
}

// ---------- 配置与注册表 ----------

export type ProviderKind = 'llm' | 'asr' | 'tts' | 'realtime' | 'search' | 'evaluator';

export interface DriverConfig {
  driver: string;
  [key: string]: unknown;
}

export type CapabilityConfig = Partial<Record<ProviderKind, DriverConfig>>;

export interface OpenLangoConfig {
  llm?: DriverConfig;
  asr?: DriverConfig;
  tts?: DriverConfig;
  realtime?: DriverConfig;
  search?: DriverConfig;
  evaluator?: DriverConfig;
  database?: { file: string };
  /** 按模块生成参数（temperature/maxTokens），见 config/openlango.config.yaml */
  generation?: Record<string, { temperature?: number; maxTokens?: number }>;
}
