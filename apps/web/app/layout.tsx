import type { Metadata } from 'next';
import { TopNav } from '@/components/TopNav';
import './globals.css';

export const metadata: Metadata = {
  title: 'OpenLango',
  description: 'Open, modular language-learning harness',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        {/* 外观主题偏好：首屏渲染前恢复（防闪色） */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{" +
              "var t=localStorage.getItem('openlango-theme');if(t)document.documentElement.dataset.theme=t;" +
              "var m=localStorage.getItem('openlango-mode')||'system';" +
              "var light=m==='light'||(m==='system'&&window.matchMedia('(prefers-color-scheme: light)').matches);" +
              "document.documentElement.dataset.mode=light?'light':'dark';" +
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
