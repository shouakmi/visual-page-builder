import type { ButtonHTMLAttributes, Ref } from 'react';

import { cn } from '../utils/cn.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-foreground hover:bg-accent-hover',
  secondary:
    'bg-surface-raised text-foreground border border-border hover:border-border-strong hover:bg-surface-sunken',
  ghost: 'text-foreground-muted hover:bg-surface-sunken hover:text-foreground',
  danger: 'bg-danger text-danger-foreground hover:opacity-90',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2 text-xs gap-1',
  md: 'h-9 px-3 text-sm gap-1.5',
};

/**
 * The base button.
 *
 * Notes that are easy to skip and expensive to retrofit:
 * - `type="button"` is the default. HTML's default is `submit`, which silently
 *   posts the nearest form; in an editor full of inline inputs that is a bug
 *   waiting to happen.
 * - A visible `focus-visible` ring is mandatory, not decorative. Keyboard users
 *   cannot operate a toolbar without one.
 * - No `forwardRef`: React 19 passes `ref` as an ordinary prop.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium',
        'transition-colors duration-150 select-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
}
