'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/card';

const SKILL_ZH: Record<string, string> = {
  reading: '阅读',
  listening: '听力',
  speaking: '口语',
  vocabulary: '词汇',
  grammar: '语法',
};

interface Status {
  bands: Record<string, string>;
  progress?: Record<string, number>;
  lastSession?: { id: string; module: string; title: string } | null;
  placed: boolean;
  suggestRecalibration?: boolean;
  dueVocab: number;
  dueGrammar: number;
  learningWords: number;
  masteredWords: number;
  llmConfigured: boolean;
}

const DOTS = 5;

function ProgressDots({ p }: { p: number }) {
  const filled = Math.round(p * DOTS);
  return (
    <div className="mt-1.5 flex justify-center gap-[3px]">
      {Array.from({ length: DOTS }).map((_, i) => (
        <span key={i} className={`h-[5px] w-[5px] rounded-full ${i < filled ? 'bg-primary' : 'bg-border'}`} />
      ))}
    </div>
  );
}

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch('/api/learner')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const showSkeleton = status === null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-bold">仪表盘</h1>
      <p className="mt-1 text-sm text-muted-foreground">模型可换，学习状态持久。</p>

      {status && !status.llmConfigured && (
        <div className="mt-5 rounded-lg border border-warn/60 bg-warn/10 p-4 text-sm">
          ⚠️ <b>模型未配置</b>：复制 <code>.env.example</code> 为 <code>.env</code> 填入 API key 后重启 dev。
          去 <Link href="/settings" className="text-primary underline">设置与状态</Link> 页可一键测试连接。
        </div>
      )}

      {status?.suggestRecalibration && (
        <div className="mt-5 rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm">
          📐 最近练测表现和当前等级有些出入，有空时可以
          <Link href="/placement" className="text-primary underline"> 重新校准一下等级</Link>（不影响使用，成绩不显示）。
        </div>
      )}

      {showSkeleton && (
        <div className="mt-5 grid gap-3">
          <div className="skeleton h-28 w-full" />
          <div className="grid grid-cols-2 gap-3">
            <div className="skeleton h-16 w-full" />
            <div className="skeleton h-16 w-full" />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-16 w-full" />
          ))}
        </div>
      )}

      {status && (
        <>
          <Card className="shadow-card mt-5">
            <CardTitle>当前等级（圆点 = 带内进度，离下一级越满升带越近）</CardTitle>
            <div className="grid grid-cols-5 gap-2">
              {Object.entries(status.bands).map(([skill, cefr]) => (
                <div key={skill} className="rounded-lg border border-border bg-muted p-3 text-center">
                  <div className="text-xs text-muted-foreground">{SKILL_ZH[skill]}</div>
                  <div className="text-[20px] font-bold text-primary">{cefr}</div>
                  <ProgressDots p={status.progress?.[skill] ?? 0} />
                </div>
              ))}
            </div>
          </Card>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Card className="shadow-card flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">今日复习</div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">
                  词汇 {status.dueVocab} · 语法 {status.dueGrammar}
                </div>
              </div>
              <Link href="/basic" className="rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground">
                开始 →
              </Link>
            </Card>
            {status.lastSession && status.lastSession.module === 'coach' ? (
              <Card className="shadow-card flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <div className="text-sm font-semibold">继续练习</div>
                  <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    上次：{status.lastSession.title || '教练对话'}
                  </div>
                </div>
                <Link
                  href={`/coach?resume=${status.lastSession.id}`}
                  className="shrink-0 rounded-lg border border-border px-3.5 py-2 text-[13px] font-medium"
                >
                  进入 →
                </Link>
              </Card>
            ) : (
              <Card className="shadow-card flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">开始对话</div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground">场景自选，按等级对话</div>
                </div>
                <Link href="/coach" className="shrink-0 rounded-lg border border-border px-3.5 py-2 text-[13px] font-medium">
                  进入 →
                </Link>
              </Card>
            )}
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            学习中 {status.learningWords} · 已掌握 {status.masteredWords}
            {!status.placed && (
              <Link href="/placement" className="ml-2 text-warn underline">未定级 → 先做定级测试</Link>
            )}
          </div>
        </>
      )}

      <div className="mt-5 grid gap-3">
        {[
          { href: '/placement', title: '定级测试', desc: '8 题自适应，测出五维等级（必做第一步）' },
          { href: '/coach', title: 'Coach 教练对话', desc: '按等级场景对话 + 轻纠错，语音可选' },
          { href: '/article', title: 'Article 分级文章', desc: 'RSS 热点做 topic 信号，按等级生成 + 生词 + 理解题' },
          { href: '/basic', title: 'Basic 词法复习', desc: 'FSRS 复习词汇 + 弱项语法作死练-测' },
        ].map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="block rounded-lg border border-border bg-card p-4 transition hover:border-primary/50"
          >
            <div className="font-semibold">{m.title} →</div>
            <div className="mt-1 text-[13px] text-muted-foreground">{m.desc}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
