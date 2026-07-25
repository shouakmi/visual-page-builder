/**
 * PHASE F2 — the real IndexedDB `StorageAdapter`.
 *
 * The one adapter that runs in an actual browser. It shares the cross-adapter
 * contract suite with the memory adapter (so behaviour cannot diverge), and
 * these mutations pin the IndexedDB-specific decisions the shared suite cannot
 * see: overwrite-not-add, the not-found boundary, the DOMException-name error
 * mapping, and the retryable connection cache. Runs against the `storage`
 * project alone; every `find` is a single line.
 */
export default {
  name: 'F2 — IndexedDB storage adapter',
  testCommand: 'pnpm vitest run --project storage --silent',
  mutations: [
    {
      // `add` throws on an existing key, so every save after the first would
      // fail — the "overwrites a document saved under the same id" guarantee.
      name: 'saveDocument uses add, so overwriting an existing id fails',
      file: 'packages/storage/src/indexedDbStorageAdapter.ts',
      find: '          store.put(file);',
      replace: '          store.add(file);',
    },
    {
      // A missing key reported as success would hand the store `undefined` as if
      // it were a real document.
      name: 'loadDocument returns ok for a missing key instead of not-found',
      file: 'packages/storage/src/indexedDbStorageAdapter.ts',
      find: "        return found ? storageOk(found.value) : storageErr({ kind: 'not-found' });",
      replace: '        return storageOk(found?.value);',
    },
    {
      name: 'loadAssetBytes returns ok for missing bytes instead of not-found',
      file: 'packages/storage/src/indexedDbStorageAdapter.ts',
      find: "        return asset ? storageOk(asset.bytes) : storageErr({ kind: 'not-found' });",
      replace: '        return storageOk(asset?.bytes);',
    },
    {
      // The name a documents list shows the user.
      name: 'listDocuments drops the document name',
      file: 'packages/storage/src/indexedDbStorageAdapter.ts',
      find: '          name: file.project.name,',
      replace: "          name: '',",
    },
    {
      // A quota breach surfaced as a generic io-error would deny the UI the
      // chance to say "out of space" specifically.
      name: 'a QuotaExceededError is mapped to io-error instead of quota-exceeded',
      file: 'packages/storage/src/indexedDbStorageAdapter.ts',
      find: "      return storageErr({ kind: 'quota-exceeded' });",
      replace: "      return storageErr({ kind: 'io-error', detail: 'x' });",
    },
    {
      name: 'a DataCloneError is mapped to io-error instead of corrupt',
      file: 'packages/storage/src/indexedDbStorageAdapter.ts',
      find: "      return storageErr({ kind: 'corrupt', detail: describe(error) });",
      replace: "      return storageErr({ kind: 'io-error', detail: describe(error) });",
    },
    {
      // Without resetting the cached connection, a single failed open poisons the
      // adapter for the rest of its life — no later call could ever succeed.
      name: 'a failed open is cached, so a later call can never retry',
      file: 'packages/storage/src/indexedDbStorageAdapter.ts',
      find: '      connection = null;',
      replace: '',
    },
  ],
};
