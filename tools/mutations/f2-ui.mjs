/**
 * PHASE F2 — the persistence UI and its browser wiring.
 *
 * The minimal New/Save/Open toolbar and the `persistence.ts` seam. These
 * mutations pin the two things a document UI must never get wrong: it must not
 * present a failed operation as success, and it must route opens through the
 * store (which validates and resets history) rather than the raw adapter. Runs
 * against the `web` project alone; every `find` is a single line.
 */
export default {
  name: 'F2 — persistence UI + wiring',
  testCommand: 'pnpm vitest run --project web --silent',
  mutations: [
    {
      name: 'New no longer creates a document',
      file: 'apps/web/src/DocumentBar.tsx',
      find: "    store.getState().newDocument(ids, 'Untitled');",
      replace: '',
    },
    {
      // A swallowed save failure leaves the user believing their work is saved.
      name: 'a save failure is swallowed instead of shown',
      file: 'apps/web/src/DocumentBar.tsx',
      find: "      if (!result.ok) setError('Save failed');",
      replace: '',
    },
    {
      // The specific defect this slice fixed: a failed list rendered as "no
      // documents" — a failure indistinguishable from success.
      name: 'a failed document list reads as an empty list instead of an error',
      file: 'apps/web/src/DocumentBar.tsx',
      find: "      else setError('Could not list documents');",
      replace: '      else setDocuments([]);',
    },
    {
      name: 'a load failure is swallowed instead of shown',
      file: 'apps/web/src/DocumentBar.tsx',
      find: "      else setError('Could not open document');",
      replace: '',
    },
    {
      // Opening straight from the adapter skips validation and the history
      // reset, so the untrusted bytes never pass through the store's boundary.
      name: 'Open bypasses the store, loading straight from the adapter',
      file: 'apps/web/src/DocumentBar.tsx',
      find: '      const result = await store.getState().loadDocument(id);',
      replace: '      const result = await adapter.loadDocument(id);',
    },
    {
      name: 'createBrowserStorage never returns an adapter',
      file: 'apps/web/src/persistence.ts',
      find: '  return factory ? createIndexedDbStorageAdapter({ factory }) : null;',
      replace: '  return null;',
    },
    {
      // Autosave attached without an adapter (or withheld when one exists) is
      // the guard the whole "only when storage exists" rule turns on.
      name: 'attachAutosave inverts its adapter guard',
      file: 'apps/web/src/persistence.ts',
      find: '  if (!adapter) return null;',
      replace: '  if (adapter) return null;',
    },
  ],
};
