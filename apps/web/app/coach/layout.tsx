import type { Metadata } from 'next';

export const metadata: Metadata = { title: '教练对话' };
export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
