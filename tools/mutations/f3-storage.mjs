/**
 * PHASE F3 · Slice B — the `listAssetIds` enumeration.
 *
 * Byte garbage collection (Slice F) finds orphaned blobs by subtracting the
 * loaded project's asset ids from what the adapter actually holds — so a
 * `listAssetIds` that lies (drops keys, returns values instead of keys, or reads
 * the wrong store) would make GC either miss real orphans or, worse, mistake a
 * live asset for one. These mutations pin it on both adapters through the shared
 * contract suite. Runs against the `storage` project alone; every `find` is a
 * single line.
 */
export default {
  name: 'F3 — listAssetIds enumeration',
  testCommand: 'pnpm vitest run --project storage --silent',
  mutations: [
    {
      // The memory adapter reports no stored bytes — GC would think everything is
      // an orphan (or nothing is, depending on the diff direction).
      name: 'memory listAssetIds always returns an empty set',
      file: 'packages/storage/src/memoryStorageAdapter.ts',
      find: '      return storageOk([...assets.keys()]);',
      replace: '      return storageOk([]);',
    },
    {
      // `getAll` returns the stored VALUES (`{ bytes, mimeType }`), not the keys —
      // so the "ids" would be asset records, matching no AssetId.
      name: 'IndexedDB listAssetIds reads values instead of keys',
      file: 'packages/storage/src/indexedDbStorageAdapter.ts',
      find: '          const request = store.getAllKeys();',
      replace: '          const request = store.getAll();',
    },
    {
      // Enumerating the DOCUMENTS store returns project ids, not asset ids.
      name: 'IndexedDB listAssetIds enumerates the wrong object store',
      file: 'packages/storage/src/indexedDbStorageAdapter.ts',
      find: "        const keys = await runInStore<IDBValidKey[]>(db, ASSETS, 'readonly', (store, done) => {",
      replace:
        "        const keys = await runInStore<IDBValidKey[]>(db, DOCUMENTS, 'readonly', (store, done) => {",
    },
  ],
};
