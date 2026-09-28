'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const LINKS = [
  { href: '/', label: '仪表盘', short: '盘' },
  { href: '/coach', label: '教练对话', short: '对话' },
  { href: '/article', label: '分级文章', short: '文章' },
  { href: '/basic', label: '词法复习', short: '复习' },
  { href: '/settings', label: '设置与状态', short: '设置' },
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
        <span className="font-bold text-[15px] whitespace-nowrap">
          <span className="sm:hidden">◆</span>
          <span className="hidden sm:inline">◆ OpenLango</span>
        </span>
        <nav className="flex flex-1 justify-end gap-0.5 sm:gap-1">
          {LINKS.map((l) => {
            const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  'rounded-lg px-2 py-1.5 text-[13px] whitespace-nowrap transition sm:px-3 sm:text-sm',
                  active ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="sm:hidden">{l.short}</span>
                <span className="hidden sm:inline">{l.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
