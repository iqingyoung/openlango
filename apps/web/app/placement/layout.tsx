import type { Metadata } from 'next';

export const metadata: Metadata = { title: '定级测试' };
export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
