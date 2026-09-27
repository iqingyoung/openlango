'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const SKILL_ZH: Record<string, string> = {
  reading: '阅读',
  listening: '听力',
  speaking: '口语',
  vocabulary: '词汇',
  grammar: '语法',
};

export default function Home() {
  const [status, setStatus] = useState<{
    bands: Record<string, string>;
    placed: boolean;
    suggestRecalibration?: boolean;
    dueVocab: number;
    dueGrammar: number;
    learningWords: number;
    masteredWords: number;
    llmConfigured: boolean;
  } | null>(null);

  useEffect(() => {
    fetch('/api/learner')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-bold">仪表盘</h1>
      <p className="mt-1 text-sm text-muted-foreground">模型可换，学习状态持久。</p>

      {status && !status.llmConfigured && (
        <div className="mt-5 rounded-[10px] border border-warn/60 bg-warn/10 p-4 text-sm">
          ⚠️ <b>模型未配置</b>：复制 <code>.env.example</code> 为 <code>.env</code> 填入 API key 后重启 dev。
          去 <Link href="/settings" className="text-primary underline">设置与状态</Link> 页可一键测试连接。
        </div>
      )}

      {status?.suggestRecalibration && (
        <div className="mt-5 rounded-[10px] border border-primary/40 bg-primary/5 p-4 text-sm">
          📐 最近练测表现和当前等级有些出入，有空时可以
          <Link href="/placement" className="text-primary underline"> 重新校准一下等级</Link>（不影响使用，成绩不显示）。
        </div>
      )}

      {status && (
        <Card className="mt-5">
          <CardTitle>当前等级</CardTitle>
          <div className="flex flex-wrap gap-3">
            {Object.entries(status.bands).map(([skill, cefr]) => (
              <div key={skill} className="flex-1 rounded-[10px] border border-border bg-muted p-3 text-center">
                <div className="text-xs text-muted-foreground">{SKILL_ZH[skill]}</div>
                <div className="text-[22px] font-bold text-primary">{cefr}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            待复习词汇 {status.dueVocab} · 待练语法 {status.dueGrammar} · 学习中 {status.learningWords} · 已掌握 {status.masteredWords}
            {!status.placed && (
              <Link href="/placement" className="ml-2 text-warn underline">未定级 → 先做定级测试</Link>
            )}
          </div>
        </Card>
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
            className="block rounded-[10px] border border-border bg-card p-4 transition hover:border-primary/50"
          >
            <div className="font-semibold">{m.title} →</div>
            <div className="mt-1 text-[13px] text-muted-foreground">{m.desc}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
