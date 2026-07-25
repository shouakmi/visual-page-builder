import {
  BASE_BREAKPOINT_ID,
  MOBILE_BREAKPOINT_ID,
  TABLET_BREAKPOINT_ID,
  createBuiltinRegistry,
  createIdFactory,
  type BreakpointId,
} from '@vpb/core';
import { createEditorStore } from '@vpb/state';
import { AppShell, Button, Panel, ThemeToggle } from '@vpb/ui';
import { useStore } from 'zustand';

import { AssetPanel } from './AssetPanel.tsx';
import { Canvas } from './Canvas.tsx';
import { createAssetResolver } from './assetResolver.ts';
import { DocumentBar } from './DocumentBar.tsx';
import { attachAutosave, createBrowserStorage } from './persistence.ts';
import { starterProject } from './starterProject.ts';

/**
 * The application shell.
 *
 * The canvas is real: a real project, through the real store, compiled by the
 * real compiler, rendered by the real renderer, in a sandboxed frame. The
 * panels around it are still empty and still say so — stubbing a fake Style
 * panel would be exactly the "declared complete, does nothing" pattern the audit
 * catalogued. Each names the phase that fills it.
 */

/**
 * One store for the app's lifetime.
 *
 * Module scope rather than a hook because the document outlives any component
 * and must not be rebuilt by a re-render. Phase F replaces the starter project
 * with a file the user opened; nothing else here changes.
 */
const ids = createIdFactory();

/**
 * The browser's persistence, wired once. `indexedDB` is read here — the single
 * browser-specific line — and handed to `createBrowserStorage`; everything
 * downstream takes the resulting adapter (or `null`). Autosave is attached only
 * when an adapter exists, and the document toolbar renders only then.
 */
const storage = createBrowserStorage(typeof indexedDB === 'undefined' ? undefined : indexedDB);

const store = createEditorStore({
  project: starterProject(),
  env: { registry: createBuiltinRegistry() },
  ...(storage ? { storage } : {}),
});

const autosave = attachAutosave(store, storage);

/**
 * The host asset resolver, wired once (Phase F3, Slice F). It bridges a managed
 * asset's opaque `asset:<id>` src to a live `blob:` URL by loading its bytes
 * through the adapter — the one place `URL.createObjectURL` belongs. Null without
 * storage: there are no managed assets to resolve then. Its object-URL lifetime is
 * the page's, disposed on hot-replace alongside the autosave controller below.
 */
const assetResolver = storage
  ? createAssetResolver({ loadBytes: (id) => storage.loadAssetBytes(id) })
  : null;

/**
 * Dispose the page-scoped controllers when this module is hot-replaced in dev, so
 * an orphaned autosave timer can't fire against a discarded store and an orphaned
 * resolver can't strand its object URLs. In production there is no earlier owner to
 * clean up after: the page's lifetime IS their lifetime, and unload needs no
 * teardown.
 */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    autosave?.dispose();
    assetResolver?.dispose();
  });
}

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

const DEVICES: Array<{ id: BreakpointId; label: string }> = [
  { id: BASE_BREAKPOINT_ID, label: 'Desktop' },
  { id: TABLET_BREAKPOINT_ID, label: 'Tablet' },
  { id: MOBILE_BREAKPOINT_ID, label: 'Mobile' },
];

/**
 * Switches the emulated device.
 *
 * Not a command and not in history: AUDIT §4.3 found the prototype committing
 * breakpoint switches to the undo stack, so Ctrl+Z rewound the user's *view*.
 * This calls a context action, which never records an entry.
 */
function DeviceSwitcher() {
  const active = useStore(store, (state) => state.present.context.activeBreakpointId);

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Device">
      {DEVICES.map(({ id, label }) => (
        <Button
          key={id}
          size="sm"
          variant={active === id ? 'secondary' : 'ghost'}
          aria-pressed={active === id}
          onClick={() => store.getState().setActiveBreakpoint(id)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

/** Real undo/redo, disabled from the real history. */
function HistoryControls() {
  const history = useStore(store, (state) => state.history);

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={history.past.length === 0}
        title={history.past.at(-1) ? `Undo ${history.past.at(-1)?.label}` : 'Nothing to undo'}
        onClick={() => store.getState().undo()}
      >
        Undo
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={history.future.length === 0}
        title={history.future.at(-1) ? `Redo ${history.future.at(-1)?.label}` : 'Nothing to redo'}
        onClick={() => store.getState().redo()}
      >
        Redo
      </Button>
    </>
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
            v0.1.0 · Phase D
          </span>
          {storage && (
            <>
              <span className="mx-1 h-5 w-px bg-border" aria-hidden />
              <DocumentBar store={store} adapter={storage} ids={ids} />
            </>
          )}
          <div className="ml-auto flex items-center gap-1">
            <DeviceSwitcher />
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            <HistoryControls />
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
                { phase: 'E', label: 'Drag onto the canvas' },
                { phase: 'H', label: 'Library: 30+ components' },
              ]}
            />
          </Panel>
          <Panel title="Layers">
            <Roadmap
              items={[
                { phase: 'E', label: 'Select, drag, reorder, nest' },
                { phase: 'H', label: 'Rename, lock, hide' },
              ]}
            />
          </Panel>
          <Panel title="Assets">
            {storage ? (
              <AssetPanel store={store} adapter={storage} ids={ids} />
            ) : (
              <Roadmap items={[{ phase: 'F', label: 'Durable binary storage' }]} />
            )}
          </Panel>
        </>
      }
      center={<Canvas store={store} resolver={assetResolver} />}
      right={
        <>
          <Panel title="Style">
            <Roadmap
              items={[
                { phase: 'E', label: 'Select an element to style it' },
                { phase: 'H', label: 'Full visual editor' },
              ]}
            />
          </Panel>
          <Panel title="This canvas">
            <ul className="flex flex-col gap-1.5 text-xs text-foreground-muted">
              <li>Compiled by the same emitter the export will use</li>
              <li>Rendered from the component registry, not a switch</li>
              <li>Sandboxed frame: same-origin, no scripts</li>
              <li>Resize the device — the real media queries fire</li>
            </ul>
          </Panel>
        </>
      }
    />
  );
}
