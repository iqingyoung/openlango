'use client';

import { useEffect, useRef, useState } from 'react';
import VoicePanel from './VoicePanel';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
  corrections?: Array<{ wrong: string; fix: string; note?: string }>;
}

interface Scenario {
  title: string;
  persona: string;
  goal: string;
  targetWords: string[];
}

export default function CoachPage() {
  const [interest, setInterest] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 新消息/流式增量时自动滚到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function start() {
    if (!interest.trim() || busy) return;
    setBusy(true);
    const res = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'scenario', interest }),
    });
    const data = await res.json();
    setBusy(false);
    setSessionId(data.sessionId);
    setScenario(data.scenario);
    if (data.source === 'fallback') {
      setWarning('⚠️ LLM 调用失败，当前是兜底场景（无模型参与）。请到 设置与状态 页测试连接，检查 .env 与 dev 重启。');
    } else {
      setWarning(null);
    }
    setMessages([{ role: 'assistant', text: `Scenario ready: ${data.scenario.title}. ${data.scenario.goal} Let's begin!` }]);
  }

  async function send() {
    if (!sessionId || !input.trim() || busy) return;
    const text = input.trim();
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }, { role: 'assistant', text: '' }]);
    setBusy(true);
    const res = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'turn', sessionId, text }),
    });
    const contentType = res.headers.get('content-type') ?? '';

    // 非 SSE：block 短路 / 错误 / 场景兜底等 JSON 响应
    if (!contentType.includes('text/event-stream')) {
      const data = await res.json();
      setBusy(false);
      if (!res.ok) {
        setMessages((m) => [...m.slice(0, -1), { role: 'assistant', text: `❌ ${data.error ?? '请求失败'}` }]);
        return;
      }
      setMessages((m) => [...m.slice(0, -1), { role: 'assistant', text: data.nudge ?? '' }]);
      return;
    }

    // SSE 流式增量渲染
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let reply = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split('\n\n');
      buf = frames.pop() ?? '';
      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith('data:')) continue;
        const ev = JSON.parse(line.slice(5).trim()) as
          | { type: 'delta'; text: string }
          | { type: 'done' }
          | { type: 'corrections'; corrections: Msg['corrections'] }
          | { type: 'error'; message: string };
        if (ev.type === 'delta') {
          reply += ev.text;
          setMessages((m) => [...m.slice(0, -1), { role: 'assistant', text: reply }]);
        } else if (ev.type === 'corrections') {
          setMessages((m) => [...m.slice(0, -1), { role: 'assistant', text: reply, corrections: ev.corrections }]);
        } else if (ev.type === 'error') {
          setMessages((m) => [...m.slice(0, -1), { role: 'assistant', text: `❌ ${ev.message}` }]);
        }
      }
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-bold">教练对话</h1>

      {!sessionId && (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            输入你想练的场景（如：机场值机、面试、点咖啡、聊 AI 新闻）。
          </p>
          <div className="mt-4 flex gap-2">
            <input
              value={interest}
              onChange={(e) => setInterest(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && start()}
              placeholder="想练什么场景？"
              className="flex-1 rounded-lg border border-border bg-muted px-4 py-2.5 text-sm outline-none focus:border-primary/60"
            />
            <Button onClick={start} disabled={busy}>生成场景</Button>
          </div>
        </>
      )}

      {scenario && (
        <Card className="mt-5">
          <div className="font-semibold">{scenario.title}</div>
          <div className="mt-1 text-[13px] text-muted-foreground">{scenario.persona}</div>
          <div className="mt-1 text-[13px] text-muted-foreground">目标：{scenario.goal}</div>
          {scenario.targetWords.length > 0 && (
            <div className="mt-2 text-[13px]">
              目标词：
              {scenario.targetWords.map((w) => (
                <span key={w} className="mr-1.5 inline-block rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs">{w}</span>
              ))}
            </div>
          )}
        </Card>
      )}

      {warning && (
        <div className="mt-4 rounded-[10px] border border-warn/60 bg-warn/10 p-3 text-[13px]">{warning}</div>
      )}

      <div ref={scrollRef} className="mt-4 grid max-h-[55vh] gap-2.5 overflow-y-auto">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
              m.role === 'user' ? 'ml-auto bg-primary/20' : 'border border-border bg-card'
            }`}
          >
            <div>{m.text}</div>
            {m.corrections && m.corrections.length > 0 && (
              <div className="mt-2 border-t border-dashed border-border pt-2 text-[12.5px] text-muted-foreground">
                {m.corrections.map((c, j) => (
                  <div key={j}>
                    💡 {c.wrong} → <span className="text-primary">{c.fix}</span>
                    {c.note ? ` (${c.note})` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {sessionId && (
        <div className="mt-4 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder={busy ? '教练思考中…' : '用英语说点什么…'}
            className="flex-1 rounded-lg border border-border bg-muted px-4 py-2.5 text-sm outline-none focus:border-primary/60"
          />
          <Button onClick={send} disabled={busy}>{busy ? '…' : '发送'}</Button>
        </div>
      )}
    </main>
  );
}
