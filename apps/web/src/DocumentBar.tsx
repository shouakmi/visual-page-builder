import type { IdFactory } from '@vpb/core';
import type { EditorStore } from '@vpb/state';
import type { DocumentSummary, StorageAdapter } from '@vpb/storage';
import { Button } from '@vpb/ui';
import { useRef, useState } from 'react';
import { useStore, type StoreApi } from 'zustand';

/**
 * The minimal document toolbar — New, Save, Open, a dirty indicator, and an
 * error surface (F2).
 *
 * Deliberately thin: it owns no editor state, only drives the store's existing
 * persistence actions. It holds the adapter reference solely to LIST documents
 * (a read the store has no reason to expose); OPENING one still goes through
 * `store.loadDocument`, so the untrusted bytes are validated and history is
 * reset in exactly one place.
 *
 * A failed operation is never presented as success: a failed `listDocuments`
 * shows an error rather than an empty "no documents" list, and a failed
 * `save`/`loadDocument` shows an error rather than silently doing nothing.
 */

type Busy = 'idle' | 'saving' | 'listing' | 'opening';

interface DocumentBarProps {
  readonly store: StoreApi<EditorStore>;
  readonly adapter: StorageAdapter;
  /** Mints ids for New. Cryptographically random, so documents never collide. */
  readonly ids: IdFactory;
}

export function DocumentBar({ store, adapter, ids }: DocumentBarProps) {
  const dirty = useStore(store, (state) => state.isDirty());
  const name = useStore(store, (state) => state.present.project.name);
  const [busy, setBusy] = useState<Busy>('idle');
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<readonly DocumentSummary[] | null>(null);

  // A ref, not `busy`, is the overlap guard: React state updates asynchronously,
  // so two clicks in one tick would both read a stale 'idle'. The ref flips
  // synchronously, so a second async action while one is in flight is refused.
  const inFlight = useRef(false);

  async function run(kind: Exclude<Busy, 'idle'>, action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(kind);
    setError(null);
    try {
      await action();
    } finally {
      inFlight.current = false;
      setBusy('idle');
    }
  }

  function newDocument() {
    if (inFlight.current) return;
    store.getState().newDocument(ids, 'Untitled');
    setError(null);
    setDocuments(null);
  }

  function save() {
    void run('saving', async () => {
      const result = await store.getState().save();
      if (!result.ok) setError('Save failed');
    });
  }

  function toggleOpen() {
    if (documents !== null) {
      setDocuments(null);
      return;
    }
    void run('listing', async () => {
      const result = await adapter.listDocuments();
      // A failed list must NOT read as "no documents".
      if (result.ok) setDocuments(result.value);
      else setError('Could not list documents');
    });
  }

  function open(id: DocumentSummary['id']) {
    void run('opening', async () => {
      // Through the store — it validates the untrusted bytes and, only on
      // success, replaces history with a fresh baseline. On failure the store is
      // untouched, so the error must be shown rather than swallowed.
      const result = await store.getState().loadDocument(id);
      if (result.ok) setDocuments(null);
      else setError('Could not open document');
    });
  }

  return (
    <div className="relative flex items-center gap-1" role="group" aria-label="Document">
      <span className="max-w-40 truncate text-sm text-foreground" title={name}>
        {name}
      </span>
      <span
        className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] text-foreground-subtle"
        aria-live="polite"
      >
        {dirty ? 'Unsaved' : 'Saved'}
      </span>
      {error && (
        <span
          role="alert"
          className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] text-foreground"
        >
          {error}
        </span>
      )}
      <Button size="sm" variant="ghost" disabled={busy !== 'idle'} onClick={newDocument}>
        New
      </Button>
      <Button size="sm" variant="ghost" disabled={busy !== 'idle'} onClick={save}>
        Save
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={documents !== null}
        disabled={busy !== 'idle'}
        onClick={toggleOpen}
      >
        Open
      </Button>
      {documents !== null && (
        <ul
          className="absolute left-0 top-full z-10 mt-1 max-h-64 min-w-40 overflow-auto rounded border border-border bg-surface-raised p-1 shadow-lg"
          aria-label="Saved documents"
        >
          {documents.length === 0 ? (
            <li className="px-2 py-1 text-xs text-foreground-muted">No saved documents</li>
          ) : (
            documents.map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  className="w-full truncate rounded px-2 py-1 text-left text-xs text-foreground hover:bg-surface-sunken"
                  onClick={() => open(doc.id)}
                >
                  {doc.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
