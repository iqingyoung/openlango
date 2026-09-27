'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';

interface Status {
  llmConfigured: boolean;
  paths?: { repoRoot: string; envFile: string; configFile: string };
}

const THEMES = [
  { id: 'emerald', color: '#10b981', label: 'Emerald' },
  { id: 'blue', color: '#3b82f6', label: 'Blue' },
  { id: 'violet', color: '#8b5cf6', label: 'Violet' },
  { id: 'rose', color: '#f43f5e', label: 'Rose' },
  { id: 'amber', color: '#f59e0b', label: 'Amber' },
  { id: 'zinc', color: '#e4e4e7', label: 'Zinc 单色' },
];

const MODES = [
  { id: 'system', label: '跟随系统' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
];

function applyMode(mode: string) {
  const light =
    mode === 'light' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.mode = light ? 'light' : 'dark';
}

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail?: string; ttftMs?: number; totalMs?: number; latencyMs?: number; sample?: string; reason?: string } | null>(null);
  const [theme, setTheme] = useState<string>('emerald');
  const [mode, setMode] = useState<string>('system');

  useEffect(() => {
    fetch('/api/learner').then((r) => r.json()).then(setStatus).catch(() => {});
    const savedTheme = localStorage.getItem('openlango-theme');
    if (savedTheme) setTheme(savedTheme);
    const savedMode = localStorage.getItem('openlango-mode') ?? 'system';
    setMode(savedMode);
    applyMode(savedMode);
    // 跟随系统时响应系统切换
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      if ((localStorage.getItem('openlango-mode') ?? 'system') === 'system') applyMode('system');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  function pickMode(id: string) {
    setMode(id);
    localStorage.setItem('openlango-mode', id);
    applyMode(id);
  }

  function pickTheme(id: string) {
    setTheme(id);
    localStorage.setItem('openlango-theme', id);
    document.documentElement.dataset.theme = id; // 全局生效，即点即换
  }

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch('/api/llm-test', { method: 'POST' });
      setResult(await res.json());
    } catch {
      setResult({ ok: false, detail: '请求失败：dev 服务是否在跑？' });
    }
    setTesting(false);
  }

  const paths = status?.paths;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-bold">设置与状态</h1>

      <Card className="mt-5">
        <div className="font-semibold">外观模式</div>
        <div className="mb-3 mt-2 text-sm text-muted-foreground">
          跟随系统 / 浅色 / 深色；保存在本浏览器，首屏无闪烁。
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => pickMode(m.id)}
              className={cn(
                'px-4 py-1.5 text-[13px] transition',
                mode === m.id ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="mt-4">
        <div className="font-semibold">主题色</div>
        <div className="mb-3 mt-2 text-sm text-muted-foreground">
          即点即换，全站生效；与外观模式相互独立。
        </div>
        <div className="flex flex-wrap gap-2.5">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => pickTheme(t.id)}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] transition',
                theme === t.id ? 'border-foreground/60 bg-muted' : 'border-border hover:border-foreground/40',
              )}
            >
              <span className="inline-block h-4 w-4 rounded" style={{ background: t.color }} />
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="mt-4">
        <div className="font-semibold">LLM 连接</div>
        <div className="mb-3 mt-2 text-sm text-muted-foreground">
          当前状态：{status === null ? '加载中…' : status.llmConfigured ? '✅ 已配置' : '❌ 未配置'}
        </div>
        <Button onClick={test} disabled={testing}>
          {testing ? '测试中…（最长 30 秒）' : '测试连接'}
        </Button>
        {result && (
          <div className={`mt-3 text-sm ${result.ok ? 'text-primary' : 'text-danger'}`}>
            {result.ok
              ? `✅ 调用成功 · 首 token ${result.ttftMs}ms · 总耗时 ${result.totalMs}ms · 回复：${result.sample}`
              : `❌ ${result.reason === 'not-configured' ? '未配置' : '调用失败'}：${result.detail ?? ''}`}
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <div className="font-semibold">配置在哪改（文件态，无表单 UI）</div>
        <div className="mt-2 text-sm leading-7 break-all">
          <div>
            🔑 API key：
            <code className="rounded bg-muted px-2 py-0.5 text-[13px]">{paths?.envFile ?? '解析中…'}</code>
            （从 .env.example 复制；key 永不进 git）
          </div>
          <div>
            🎛 模型路由：
            <code className="rounded bg-muted px-2 py-0.5 text-[13px]">{paths?.configFile ?? '解析中…'}</code>
            （每个能力位选模型，改完全量生效）
          </div>
          <div>⚠️ 两处文件修改后都要重启 <code className="rounded bg-muted px-2 py-0.5 text-[13px]">pnpm web:dev</code> 才生效</div>
        </div>
      </Card>

      <Card className="mt-4">
        <div className="font-semibold">导出</div>
        <div className="mb-3 mt-2 text-sm text-muted-foreground">
          Anki 牌组（词汇 + 语法，双牌组 .apkg，导入时自动建牌）；词汇仅含学习集内的词。
        </div>
        <Button variant="ghost" onClick={() => window.open('/api/export/anki', '_blank')}>
          ⬇ 下载 Anki 牌组 (.apkg)
        </Button>
      </Card>

      <Card className="mt-4">
        <div className="font-semibold">关于 Preferences</div>
        <div className="mt-2 text-sm text-muted-foreground">
          外观主题存浏览器本地即点即换；模型、语音通道、成本档位等“能力位”配置全部由 YAML/env 决定（配置即文档），
          界面只读展示。运行时热切换按计划放在 v0.2+ 的 provider 插件系统里。
        </div>
      </Card>
    </main>
  );
}
