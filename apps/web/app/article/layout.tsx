import type { Metadata } from 'next';

export const metadata: Metadata = { title: '分级文章' };
export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
