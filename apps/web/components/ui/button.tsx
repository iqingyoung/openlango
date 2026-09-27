import { cn } from '@/lib/cn';
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'default' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground font-semibold hover:brightness-110',
  ghost: 'border border-border bg-transparent text-foreground hover:bg-muted',
  danger: 'bg-danger text-background font-semibold hover:brightness-110',
};

export function Button({
  variant = 'default',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm cursor-pointer transition',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
