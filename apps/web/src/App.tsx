import { AppShell, Button, Panel, ThemeToggle } from '@vpb/ui';

import { TokenGallery } from './dev/TokenGallery.tsx';

/**
 * The application shell.
 *
 * The sidebars are intentionally empty and say so. Phase A's contract is the
 * foundation — install, typecheck, test, build, theme — and stubbing a fake
 * Components tree or a fake Style panel here would be exactly the "declared
 * complete, does nothing" pattern the audit catalogued. Each panel names the
 * phase that fills it, so the gap is legible rather than disguised.
 */

function Roadmap({ items }: { items: Array<{ phase: string; label: string }> }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map(({ phase, label }) => (
        <li key={label} className="flex items-center gap-2 text-xs text-foreground-muted">
          <span className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[10px] text-foreground-subtle">
            {phase}
          </span>
          <span className="truncate">{label}</span>
        </li>
      ))}
    </ul>
  );
}

export function App() {
  return (
    <AppShell
      topBar={
        <>
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Visual Page Builder
          </span>
          <span className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[10px] text-foreground-subtle">
            v0.1.0 · Phase A
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" disabled title="Arrives in Phase C">
              Undo
            </Button>
            <Button size="sm" variant="ghost" disabled title="Arrives in Phase C">
              Redo
            </Button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            <ThemeToggle />
          </div>
        </>
      }
      left={
        <>
          <Panel title="Components">
            <Roadmap
              items={[
                { phase: 'B', label: 'Component registry' },
                { phase: 'H', label: 'Library: 30+ components' },
              ]}
            />
          </Panel>
          <Panel title="Layers">
            <Roadmap
              items={[
                { phase: 'B', label: 'Node tree + index' },
                { phase: 'E', label: 'Drag, reorder, nest' },
              ]}
            />
          </Panel>
          <Panel title="Assets">
            <Roadmap items={[{ phase: 'F', label: 'Durable binary storage' }]} />
          </Panel>
        </>
      }
      center={<TokenGallery />}
      right={
        <>
          <Panel title="Style">
            <Roadmap
              items={[
                { phase: 'B', label: 'Structured style model' },
                { phase: 'D', label: 'Style compiler' },
                { phase: 'H', label: 'Full visual editor' },
              ]}
            />
          </Panel>
          <Panel title="Foundation">
            <ul className="flex flex-col gap-1.5 text-xs text-foreground-muted">
              <li>Workspace resolves via package exports</li>
              <li>Tokens shared across packages</li>
              <li>Light / dark / system, persisted</li>
              <li>No flash of wrong theme on load</li>
            </ul>
          </Panel>
        </>
      }
    />
  );
}
