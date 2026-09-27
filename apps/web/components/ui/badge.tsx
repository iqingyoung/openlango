import { cn } from '@/lib/cn';
import type { HTMLAttributes } from 'react';

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-block rounded-full border border-border bg-muted px-3 py-0.5 text-xs',
        className,
      )}
      {...props}
    />
  );
}
