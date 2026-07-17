import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../utils/cn.ts';

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  title: string;
  /** Right-aligned slot in the header: counts, add buttons, overflow menus. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * A titled surface. The workhorse container of every sidebar in the editor.
 *
 * A landmark `<section>` with an accessible name, not a bare `<div>`, so screen
 * reader users can enumerate the panels and jump between them. A `<section>`
 * only becomes a navigable landmark once it HAS a name — unnamed, it is ignored
 * entirely — which is why `title` is required rather than optional.
 *
 * The name comes from `aria-label` rather than `aria-labelledby` + `useId`: the
 * visible `<h2>` already carries the same string, and pointing at it would make
 * assistive tech announce the title twice.
 */
export function Panel({ title, actions, children, className, ...rest }: PanelProps) {
  return (
    <section
      className={cn('flex flex-col rounded-lg border border-border bg-surface-raised', className)}
      aria-label={title}
      {...rest}
    >
      <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
          {title}
        </h2>
        {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-2.5">{children}</div>
    </section>
  );
}
