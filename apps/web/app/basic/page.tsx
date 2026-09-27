'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface VocabCard {
  id: string;
  word: string;
  cefr: string | null;
}
interface GrammarDrill {
  id: string;
  grammarId: string;
  name: string;
  zh: string;
  nonce: number;
  prompt: string;
  options: string[];
  kind: string;
}

const RATING_LABEL: Record<number, string> = { 1: '忘了', 2: '很难', 3: '记得', 4: '轻松' };
const RATING_COLOR: Record<number, string> = {
  1: 'text-danger', 2: 'text-warn', 3: 'text-primary', 4: 'text-sky-400',
};

export default function BasicPage() {
  const [dueVocab, setDueVocab] = useState<VocabCard[]>([]);
  const [dueGrammar, setDueGrammar] = useState<GrammarDrill[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [grammarFeedback, setGrammarFeedback] = useState<Record<string, { correct: boolean; answer: string }>>({});

  const load = useCallback(async () => {
    const res = await fetch('/api/basic');
    const data = await res.json();
    setDueVocab(data.dueVocab ?? []);
    setDueGrammar(data.dueGrammar ?? []);
    setGrammarFeedback({});
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function reviewVocab(id: string, rating: number) {
    await fetch('/api/basic', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'vocab', id, rating }),
    });
    setDueVocab((v) => v.filter((c) => c.id !== id));
  }

  async function answerGrammar(drill: GrammarDrill, chosen: number) {
    const res = await fetch('/api/basic', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'grammar', id: drill.id, nonce: drill.nonce, chosen }),
    });
    const data = await res.json();
    setGrammarFeedback((f) => ({ ...f, [drill.id]: { correct: data.correct, answer: data.answer } }));
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-bold">词法复习</h1>

      <h2 className="mt-5 text-[17px] font-semibold">词汇复习（{dueVocab.length}）</h2>
      {!loaded && <div className="mt-2 text-sm text-muted-foreground">加载中…</div>}
      {loaded && dueVocab.length === 0 && (
        <div className="mt-2 text-sm text-muted-foreground">
          暂无到期词汇 —— 去 <Link href="/article" className="text-primary underline">读一篇文章</Link>，新词会自动进入复习队列。
        </div>
      )}
      <div className="mt-3 grid gap-2.5">
        {dueVocab.map((card) => (
          <Card key={card.id}>
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">{card.word}</div>
              <Badge>{card.cefr}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((r) => (
                <button
                  key={r}
                  onClick={() => reviewVocab(card.id, r)}
                  className={`rounded-lg border border-border bg-muted py-2 text-[13px] cursor-pointer ${RATING_COLOR[r]}`}
                >
                  {RATING_LABEL[r]}
                </button>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <h2 className="mt-7 text-[17px] font-semibold">语法练测（{dueGrammar.length}）</h2>
      {loaded && dueGrammar.length === 0 && (
        <div className="mt-2 text-sm text-muted-foreground">暂无到期语法点。</div>
      )}
      <div className="mt-3 grid gap-2.5">
        {dueGrammar.map((d) => {
          const fb = grammarFeedback[d.id];
          return (
            <Card key={d.id}>
              <div className="text-xs text-muted-foreground">
                {d.name}（{d.zh}）· {d.kind === 'cloze' ? '选出补全句子的词' : '选出使用了该语法点的句子'}
              </div>
              <div className="my-2.5 text-[15px]">{d.prompt}</div>
              <div className="grid gap-1.5">
                {d.options.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => !fb && answerGrammar(d, i)}
                    disabled={Boolean(fb)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                      fb && opt === fb.answer
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-muted hover:border-primary/60'
                    } disabled:cursor-not-allowed`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              {fb && (
                <div className={`mt-2.5 text-sm ${fb.correct ? 'text-primary' : 'text-danger'}`}>
                  {fb.correct ? '✓ 正确' : `✗ 正确答案：${fb.answer}`}（已排入下次复习）
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {(dueVocab.length > 0 || dueGrammar.length > 0) && (
        <Button variant="ghost" onClick={load} className="mt-5">换一批 / 刷新</Button>
      )}
    </main>
  );
}
