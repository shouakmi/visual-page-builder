import type { ReactNode } from 'react';

import { cn } from '../utils/cn.ts';

export interface AppShellProps {
  topBar: ReactNode;
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  /** Code editor drawer. Absent until Phase D wires Monaco in. */
  bottom?: ReactNode;
  className?: string;
}

/**
 * The editor frame: top bar, left rail, canvas, right rail, optional drawer.
 *
 * Slots rather than children, so the layout owns geometry and callers own
 * content. This is the wireframe from Phase 1 of the original plan, unchanged —
 * that layout was sound and there is no reason to redesign it.
 *
 * `min-h-0` appears on every flex/grid child that contains a scroll region.
 * Without it a flex child's implicit `min-height: auto` refuses to shrink below
 * its content, the child grows past the viewport, and the *page* scrolls instead
 * of the panel. In an app shell that must never scroll as a whole, this single
 * utility is what keeps the layout honest.
 */
export function AppShell({ topBar, left, center, right, bottom, className }: AppShellProps) {
  return (
    <div
      className={cn(
        'flex h-dvh w-full flex-col overflow-hidden bg-surface text-foreground',
        className,
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3">
        {topBar}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className="flex w-64 shrink-0 flex-col gap-2 overflow-auto border-r border-border p-2"
          aria-label="Left sidebar"
        >
          {left}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="min-h-0 flex-1 overflow-auto bg-surface-sunken" aria-label="Canvas">
            {center}
          </main>
          {bottom ? <div className="shrink-0 border-t border-border">{bottom}</div> : null}
        </div>

        <aside
          className="flex w-72 shrink-0 flex-col gap-2 overflow-auto border-l border-border p-2"
          aria-label="Right sidebar"
        >
          {right}
        </aside>
      </div>
    </div>
  );
}
