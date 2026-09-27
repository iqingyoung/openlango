import { NextResponse } from 'next/server';
import { getLlm, getConfig } from '@/lib/server';

/** LLM 连接测试：流式调用，报告首 token 时延（TTFT）与总时延 */
export async function POST() {
  const llm = getLlm();
  if (!llm) {
    const cfg = getConfig();
    return NextResponse.json({
      ok: false,
      reason: 'not-configured',
      detail: `driver=${cfg.llm?.driver ?? '无'}；检查 .env 是否存在且 key 已填，填完需重启 dev`,
    });
  }
  const start = Date.now();
  try {
    let ttft: number | null = null;
    let sample = '';
    let events = 0;
    for await (const delta of llm.chatStream({
      messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
      maxTokens: 50,
      temperature: 0,
      signal: AbortSignal.timeout(30_000),
    })) {
      events++;
      if (ttft === null) ttft = Date.now() - start;
      sample += delta;
      if (sample.length > 40) break;
    }
    const cfg = getConfig();
    return NextResponse.json({
      ok: true,
      ttftMs: ttft,
      totalMs: Date.now() - start,
      sample: sample.trim().slice(0, 40),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      reason: 'call-failed',
      detail: (err as Error).message.slice(0, 300),
      latencyMs: Date.now() - start,
    });
  }
}

export const dynamic = 'force-dynamic';
