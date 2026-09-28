import type { Metadata } from 'next';
import { TopNav } from '@/components/TopNav';
import './globals.css';

export const metadata: Metadata = {
  title: {
    template: '%s · OpenLango',
    default: 'OpenLango',
  },
  description: 'Open, modular language-learning harness',
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M6 4h20l-8 10 8 10v4H6l8-14z' fill='%2310b981'/%3E%3C/svg%3E",
  },
};

/** 旧「模式+主题色」机制 → 新「风格方案」迁移映射 */
const PRESETS = ['a', 'b', 'c', 'd'] as const;
const LEGACY_MAP: Record<string, string> = {
  violet: 'b',
  emerald: 'a',
  blue: 'd',
  rose: 'c',
  amber: 'c',
  zinc: 'a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-preset="a">
      <head>
        {/* 风格方案：首屏渲染前恢复（防闪色）；旧 localStorage 键自动迁移 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{" +
              "var PRESETS=['a','b','c','d'];var LEG={violet:'b',emerald:'a',blue:'d',rose:'c',amber:'c',zinc:'a'};" +
              "var p=localStorage.getItem('openlango-preset');" +
              "if(!p||PRESETS.indexOf(p)<0){" +
              "p=LEG[localStorage.getItem('openlango-theme')]||'a';" +
              "localStorage.setItem('openlango-preset',p);}" +
              "document.documentElement.dataset.preset=p;" +
              "}catch(e){}",
          }}
        />
      </head>
      <body>
        <TopNav />
        {children}
      </body>
    </html>
  );
}
