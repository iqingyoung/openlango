'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ArticleData {
  id: string;
  title: string;
  body: string;
  cefr: string;
  newWords: Array<{ word: string; cefr: string }>;
  grammarPoints: Array<{ id: string; name: string; zh: string }>;
  quiz: Array<{ q: string; options: string[]; answerIndex: number }>;
  sources: Array<{ title: string; url: string }>;
  flaggedSnippets: string[];
}

export default function ArticlePage() {
  const [topic, setTopic] = useState('');
  const [freshness, setFreshness] = useState<'day' | 'week'>('week');
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [score, setScore] = useState<{ total: number; correctCount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'idle' | 'search' | 'compose'>('idle');
  const [stageInfo, setStageInfo] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setStage('idle');
    setStageInfo(null);
  }

  useEffect(() => {
    if (stage === 'idle') return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

  async function generate() {
    if (!topic.trim() || busy) return;
    setBusy(true);
    setError(null);
    setArticle(null);
    setScore(null);
    setAnswers([]);
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;

    // 第一段：抓热点（秒级）
    setStage('search');
    try {
      const r1 = await fetch('/api/article', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'search', topic, freshness }),
        signal,
      });
      const d1 = await r1.json();
      if (!r1.ok) {
        setBusy(false);
        setStage('idle');
        setError(d1.error ?? '抓取热点失败');
        return;
      }
      setStageInfo(`已抓取 ${d1.sources.length} 条热点信号（过滤 ${d1.flaggedSnippets.length} 条可疑内容）`);

      // 第二段：LLM 生成（较慢）
      setStage('compose');
      const r2 = await fetch('/api/article', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'compose', topic, sources: d1.sources }),
        signal,
      });
      const d2 = await r2.json();
      setBusy(false);
      setStage('idle');
      setStageInfo(null);
      if (!r2.ok) {
        setError(d2.error ?? '生成失败');
        return;
      }
      setArticle(d2);
      setAnswers(new Array(d2.quiz.length).fill(-1));
    } catch (err) {
      if ((err as Error).name === 'AbortError') return; // 用户取消，静默
      setBusy(false);
      setStage('idle');
      setError((err as Error).message.slice(0, 120));
    } finally {
      abortRef.current = null;
    }
  }

  async function submitQuiz() {
    if (!article || busy) return;
    setBusy(true);
    const res = await fetch('/api/article', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'answer', articleId: article.id, answers }),
    });
    const data = await res.json();
    setBusy(false);
    setScore(data);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-bold">分级文章</h1>
      <div className="mt-4 flex gap-2">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && generate()}
          placeholder="多个话题用逗号、顿号、斜杠分隔；关键词内用空格，等同 + 号。如：ai、politics 或 gpt astra"
          className="flex-1 rounded-lg border border-border bg-muted px-4 py-2.5 text-sm outline-none focus:border-primary/60"
        />
        <Button onClick={generate} disabled={busy}>{busy ? '生成中…' : '生成'}</Button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[13px]">
        <span className="text-muted-foreground">新闻时间窗：</span>
        {([['day', '最近 24 小时'], ['week', '最近一周']] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setFreshness(v)}
            className={`rounded-full px-3 py-1 text-xs transition ${
              freshness === v ? 'bg-primary text-primary-foreground' : 'border border-border bg-muted text-muted-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="mt-3 text-sm text-danger">{error}</div>}
      {stage !== 'idle' && (
        <Card className="shadow-card mt-4 flex items-center gap-3">
          <span className="inline-block h-3.5 w-3.5 animate-slow-spin rounded-full border-2 border-primary border-t-transparent" />
          <div className="flex-1 text-sm">
            {stage === 'search'
              ? '正在抓取热点信号…'
              : '正在按你的等级生成文章…（一般 30~120 秒，取决于模型速度）'}
            <span className="ml-2 text-muted-foreground">{elapsed}s</span>
          </div>
          <Button variant="ghost" onClick={cancel} className="px-3 py-1.5 text-[13px]">取消</Button>
        </Card>
      )}
      {stageInfo && stage === 'idle' && !article && (
        <div className="mt-3 text-sm text-muted-foreground">{stageInfo}</div>
      )}

      {article && (
        <Card className="mt-5">
          <div className="flex items-baseline justify-between">
            <h2 className="m-0 text-lg font-semibold">{article.title}</h2>
            <Badge>{article.cefr}</Badge>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-[15px] leading-7">{article.body}</p>

          {article.newWords.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 text-[13px] text-muted-foreground">本篇新词（已自动加入复习队列）：</div>
              {article.newWords.map((w) => (
                <Badge key={w.word} className="mr-1.5 mb-1">{w.word} · {w.cefr}</Badge>
              ))}
            </div>
          )}
          {article.grammarPoints.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 text-[13px] text-muted-foreground">涉及语法点（可在 Basic 中练测）：</div>
              {article.grammarPoints.map((g) => (
                <Badge key={g.id} className="mr-1.5 mb-1">{g.name} · {g.zh}</Badge>
              ))}
            </div>
          )}
          {article.sources.length > 0 && (
            <div className="mt-4 text-xs text-muted-foreground">
              话题信号源：
              {article.sources.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="mr-3 text-primary underline">
                  {s.title.slice(0, 40)}
                </a>
              ))}
            </div>
          )}

          {article.quiz.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <div className="mb-3 font-semibold">理解题</div>
              {article.quiz.map((q, qi) => (
                <div key={qi} className="mb-4">
                  <div className="text-sm">{qi + 1}. {q.q}</div>
                  <div className="mt-2 grid gap-2">
                    {q.options.map((opt, oi) => (
                      <button
                        key={oi}
                        type="button"
                        onClick={() => setAnswers((a) => a.map((v, i) => (i === qi ? oi : v)))}
                        className={`cursor-pointer rounded-lg border px-3 py-2 text-left text-sm transition ${
                          answers[qi] === oi
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-muted hover:border-primary/60'
                        }`}
                      >
                        {String.fromCharCode(65 + oi)}. {opt}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <Button onClick={submitQuiz} disabled={busy || answers.some((a) => a < 0)}>提交答案</Button>
              {score && (
                <div className={`mt-3 text-sm ${score.correctCount === score.total ? 'text-primary' : ''}`}>
                  答对 {score.correctCount}/{score.total} —— 等级已自动校准
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </main>
  );
}
