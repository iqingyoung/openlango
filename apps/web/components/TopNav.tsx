'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const LINKS = [
  { href: '/', label: '仪表盘' },
  { href: '/coach', label: '教练对话' },
  { href: '/article', label: '分级文章' },
  { href: '/basic', label: '词法复习' },
  { href: '/settings', label: '设置与状态' },
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 overflow-x-auto">
        <span className="font-bold text-[15px] whitespace-nowrap">◆ OpenLango</span>
        <nav className="flex gap-1">
          {LINKS.map((l) => {
            const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition',
                  active ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
