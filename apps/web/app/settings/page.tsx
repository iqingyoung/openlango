'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';

interface Status {
  llmConfigured: boolean;
  paths?: { repoRoot: string; envFile: string; configFile: string };
}

/** 四套风格方案：与 globals.css 的 data-preset 一一对应 */
const PRESETS = [
  {
    id: 'a',
    label: 'A · 基线',
    desc: 'zinc 深色 + emerald',
    swatches: ['#09090b', '#10b981', '#27272a'],
    radius: 10,
  },
  {
    id: 'b',
    label: 'B · Linear',
    desc: '近黑 + violet，细边框',
    swatches: ['#08090d', '#7c6cf6', '#1f2330'],
    radius: 12,
  },
  {
    id: 'c',
    label: 'C · 暖纸',
    desc: 'stone 浅色 + terracotta',
    swatches: ['#faf9f7', '#c2552c', '#e5e2dc'],
    radius: 14,
  },
  {
    id: 'd',
    label: 'D · Clean',
    desc: '纯白 + indigo',
    swatches: ['#ffffff', '#4f46e5', '#e2e8f0'],
    radius: 16,
  },
];

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail?: string; ttftMs?: number; totalMs?: number; latencyMs?: number; sample?: string; reason?: string } | null>(null);
  const [preset, setPreset] = useState<string>('a');

  useEffect(() => {
    fetch('/api/learner').then((r) => r.json()).then(setStatus).catch(() => {});
    const saved = localStorage.getItem('openlango-preset');
    const id = saved && PRESETS.some((p) => p.id === saved) ? saved : 'a';
    setPreset(id);
    document.documentElement.dataset.preset = id;
  }, []);

  function pickPreset(id: string) {
    setPreset(id);
    localStorage.setItem('openlango-preset', id);
    document.documentElement.dataset.preset = id; // 全局生效，即点即换
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

      <Card className="shadow-card mt-5">
        <div className="font-semibold">风格方案</div>
        <div className="mb-3 mt-2 text-sm text-muted-foreground">
          每套自带明暗、主色与圆角，整体切换；保存在本浏览器，首屏无闪烁。
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => pickPreset(p.id)}
              className={cn(
                'rounded-lg border px-3 py-2.5 text-left transition',
                preset === p.id
                  ? 'border-foreground/60 bg-muted'
                  : 'border-border hover:border-foreground/40',
              )}
            >
              <div className="flex items-center gap-2">
                {p.swatches.map((c) => (
                  <span
                    key={c}
                    className="inline-block h-4 w-4 rounded-full border border-black/10"
                    style={{ background: c }}
                  />
                ))}
              </div>
              <div className="mt-2 text-[13px] font-semibold">{p.label}</div>
              <div className="text-[11px] text-muted-foreground">{p.desc}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card className="shadow-card mt-4">
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

      <Card className="shadow-card mt-4">
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

      <Card className="shadow-card mt-4">
        <div className="font-semibold">导出</div>
        <div className="mb-3 mt-2 text-sm text-muted-foreground">
          Anki 牌组（词汇 + 语法，双牌组 .apkg，导入时自动建牌）；词汇仅含学习集内的词。
        </div>
        <Button variant="ghost" onClick={() => window.open('/api/export/anki', '_blank')}>
          ⬇ 下载 Anki 牌组 (.apkg)
        </Button>
      </Card>

      <Card className="shadow-card mt-4">
        <div className="font-semibold">关于 Preferences</div>
        <div className="mt-2 text-sm text-muted-foreground">
          风格方案存浏览器本地即点即换；模型、语音通道、成本档位等“能力位”配置全部由 YAML/env 决定（配置即文档），
          界面只读展示。运行时热切换按计划放在 v0.2+ 的 provider 插件系统里。
        </div>
      </Card>
    </main>
  );
}
