import type { Metadata } from 'next';

export const metadata: Metadata = { title: '词法复习' };
export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
