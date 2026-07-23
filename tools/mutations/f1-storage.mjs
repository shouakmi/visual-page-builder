/**
 * PHASE F1 — the in-memory `StorageAdapter` and the contract it must satisfy.
 *
 * `memoryStorageAdapter.ts` is both a test fixture for F1's store wiring AND
 * the desktop-shaped fake F4's contract run will reuse — its own bugs would be
 * invisible until a real adapter (F2's IndexedDB one) diverged from it in
 * production. Runs against the `storage` project alone; every `find` is a
 * single line.
 */
export default {
  name: 'F1 — memory storage adapter + contract',
  testCommand: 'pnpm vitest run --project storage --silent',
  mutations: [
    {
      // A save that refuses to overwrite an existing id is a save that silently
      // does nothing on every edit after the first — the user's changes never
      // reach the "disk".
      name: 'saveDocument does not overwrite a document already saved under that id',
      file: 'packages/storage/src/memoryStorageAdapter.ts',
      find: '      documents.set(file.id, structuredClone(file));',
      replace: '      if (!documents.has(file.id)) documents.set(file.id, structuredClone(file));',
    },
    {
      // Deleting a document that silently stays around is a delete in name only.
      name: 'deleteDocument does not actually remove the document',
      file: 'packages/storage/src/memoryStorageAdapter.ts',
      find: '      documents.delete(id);',
      replace: '',
    },
    {
      // The store's `loadDocument` action pattern-matches `kind: 'not-found'` to
      // decide a document does not exist; a different kind here would surface an
      // unknown document as a generic failure instead of "not found".
      name: 'loadDocument reports the wrong error kind for an unknown document',
      file: 'packages/storage/src/memoryStorageAdapter.ts',
      find: "      return file ? storageOk(structuredClone(file)) : storageErr({ kind: 'not-found' });",
      replace:
        "      return file ? storageOk(structuredClone(file)) : storageErr({ kind: 'corrupt', detail: 'x' });",
    },
    {
      // Asset bytes that outlive their own deletion are exactly the "orphan
      // cleanup doesn't actually free anything" bug F3's asset system depends on
      // this contract to prevent.
      name: 'deleteAssetBytes does not actually remove the bytes',
      file: 'packages/storage/src/memoryStorageAdapter.ts',
      find: '      assets.delete(id);',
      replace: '',
    },
    {
      // `DocumentSummary.name` is what a documents list shows the user; losing it
      // here means every "recent projects" entry reads blank.
      name: 'listDocuments drops the document name',
      file: 'packages/storage/src/memoryStorageAdapter.ts',
      find: '        name: file.project.name,',
      replace: "        name: '',",
    },
  ],
};
