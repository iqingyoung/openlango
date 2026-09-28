'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface Item {
  prompt: string;
  options: string[];
  kind: string;
}
interface Bands {
  [skill: string]: string;
}

const SKILL_ZH: Record<string, string> = {
  reading: '阅读', listening: '听力', speaking: '口语', vocabulary: '词汇', grammar: '语法',
};

export default function PlacementPage() {
  const [runId, setRunId] = useState<string | null>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [progress, setProgress] = useState(0);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const [finished, setFinished] = useState<Bands | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setFinished(null);
    const res = await fetch('/api/placement', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    });
    const data = await res.json();
    setBusy(false);
    setRunId(data.runId);
    setItem(data.item);
    setProgress(0);
    setFeedback(null);
  }

  async function answer(chosen: number) {
    if (!runId || busy) return;
    setBusy(true);
    const res = await fetch('/api/placement', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'answer', runId, chosen }),
    });
    const data = await res.json();
    setBusy(false);
    setFeedback(data.finished ? null : data.correct);
    if (data.finished) {
      setFinished(data.bands);
      setItem(null);
    } else {
      setItem(data.item);
      setProgress(data.progress);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-bold">定级测试</h1>

      {!runId && !finished && (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            约 8 题自适应选择题（词汇填空 + 结构识别），答对升难度、答错降难度。听力/口语将在后续使用中自动校准。
          </p>
          <Button onClick={start} disabled={busy} className="mt-4">
            {busy ? '加载中…' : '开始测试'}
          </Button>
        </>
      )}

      {item && (
        <Card className="mt-5">
          <div className="text-xs text-muted-foreground">
            第 {progress + 1} 题 · {item.kind === 'cloze' ? '选出补全句子的词' : '选出使用了该语法点的句子'}
          </div>
          <div className="my-4 text-base">{item.prompt}</div>
          <div className="grid gap-2">
            {item.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => answer(i)}
                disabled={busy}
                className="rounded-lg border border-border bg-muted px-4 py-2.5 text-left text-sm transition hover:border-primary/60 disabled:opacity-50"
              >
                {opt}
              </button>
            ))}
          </div>
          {feedback !== null && (
            <div className={`mt-3 text-sm ${feedback ? 'text-primary' : 'text-danger'}`}>
              {feedback ? '✓ 正确' : '✗ 不对'}
            </div>
          )}
        </Card>
      )}

      {finished && (
        <Card className="mt-5">
          <div className="mb-3 font-semibold">定级完成（结果会随使用自动校准，无需焦虑）</div>
          <div className="flex flex-wrap gap-3">
            {Object.entries(finished).map(([skill, cefr]) => (
              <div key={skill} className="flex-1 rounded-lg border border-border bg-muted p-3 text-center">
                <div className="text-xs text-muted-foreground">{SKILL_ZH[skill]}</div>
                <div className="text-[22px] font-bold text-primary">{cefr}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-3">
            <Link href="/article"><Button>去读文章 →</Button></Link>
            <Link href="/coach"><Button variant="ghost">去对话 →</Button></Link>
          </div>
        </Card>
      )}
    </main>
  );
}
