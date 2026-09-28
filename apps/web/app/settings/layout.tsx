import type { Metadata } from 'next';

export const metadata: Metadata = { title: '设置与状态' };
export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
