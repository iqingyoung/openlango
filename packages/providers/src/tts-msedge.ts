/**
 * TTS 驱动：Microsoft Edge 免费音色（msedge-tts，纯 JS，无需 key）。
 * 默认路线：零成本语音输出。句级合成。
 * 注意：必须用 webpackIgnore 运行时原生 import（见 getModule）——msedge-tts 内部依赖
 * ws，其可选原生依赖（bufferutil）在 Next 打包环境下会被替换成空模块导致崩溃；
 * 且 msedge-tts 需加入 apps/web 的 dependencies（pnpm 严格解析）。
 * 实例按音色缓存复用（省去每句 ~1.5s 的握手），失败时重建一次。
 */
import type { DriverConfig, TTSProvider, TTSResult } from '@openlango/core';

export interface MsEdgeTTSConfig {
  driver: 'msedge';
  voice?: string; // 默认 en-US-AriaNeural
  [key: string]: unknown;
}

interface EdgeTTSInstance {
  setMetadata: (voice: string, format: unknown) => Promise<void>;
  toStream: (text: string) => { audioStream: AsyncIterable<{ buffer: ArrayBuffer }> };
}

interface EdgeModule {
  MsEdgeTTS: new () => EdgeTTSInstance;
  OUTPUT_FORMAT: Record<string, unknown>;
}

let mod: EdgeModule | null = null;

async function getModule(): Promise<EdgeModule> {
  if (mod) return mod;
  // webpackIgnore：运行时原生 import，绕开打包器（见文件头注释）
  const pkg = 'msedge-tts';
  mod = (await import(/* webpackIgnore: true */ /* @vite-ignore */ pkg)) as unknown as EdgeModule;
  return mod;
}

let cached: { voice: string; tts: EdgeTTSInstance } | null = null;

async function getInstance(voice: string): Promise<EdgeTTSInstance> {
  if (cached?.voice === voice) return cached.tts;
  const m = await getModule();
  const tts = new m.MsEdgeTTS();
  await tts.setMetadata(voice, m.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  cached = { voice, tts };
  return tts;
}

export function createMsEdgeTTS(raw: DriverConfig): TTSProvider {
  const cfg = raw as unknown as MsEdgeTTSConfig;
  const defaultVoice = cfg.voice ?? 'en-US-AriaNeural';

  return {
    driver: 'msedge',

    async synthesize(text: string, opts?: { voice?: string }): Promise<TTSResult> {
      const voice = opts?.voice ?? defaultVoice;
      // audioStream 吐的是原始 WS 消息：[u16 头长(大端)][header 如 X-RequestId/Path:audio][mp3 帧]，
      // 必须剥帧，否则浏览器报"不支持的源"（afinfo 等宽松解码器反而能容错，具迷惑性）
      const collect = async (tts: EdgeTTSInstance): Promise<ArrayBuffer> => {
        const { audioStream } = tts.toStream(text);
        const chunks: Uint8Array[] = [];
        let total = 0;
        const pushAudio = (u8: Uint8Array) => {
          if (u8.length === 0) return;
          chunks.push(u8);
          total += u8.length;
        };
        for await (const c of audioStream) {
          // c.buffer 可能是独立 ArrayBuffer，也可能是 Node Buffer（带 byteOffset 的池视图）
          const b = c.buffer as unknown as { byteOffset?: number; byteLength?: number };
          const u8 =
            b instanceof ArrayBuffer
              ? new Uint8Array(b)
              : new Uint8Array(b as ArrayBuffer, b.byteOffset ?? 0, b.byteLength ?? 0);
          if (u8.length < 4) continue;
          const hl = (u8[0]! << 8) | u8[1]!;
          const sig = String.fromCharCode(u8[2]!, u8[3]!);
          if ((sig === 'X-' || sig === 'Pa') && 2 + hl <= u8.length) {
            pushAudio(u8.subarray(2 + hl)); // 剥帧：音频在 header 之后
          } else {
            pushAudio(u8); // 兜底：无帧头则整体当音频
          }
        }
        const out = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          out.set(c, offset);
          offset += c.length;
        }
        return out.buffer;
      };
      try {
        const tts = await getInstance(voice);
        return { audio: await collect(tts), format: 'mp3' };
      } catch {
        cached = null; // 连接可能已被服务端关闭，重建一次
        const tts = await getInstance(voice);
        return { audio: await collect(tts), format: 'mp3' };
      }
    },
  };
}
