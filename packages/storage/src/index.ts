/* The contract every adapter implements. */
export type {
  DocumentSummary,
  StorageAdapter,
  StorageError,
  StorageResult,
} from './storageAdapter.ts';
export { storageErr, storageOk } from './storageAdapter.ts';

/* The in-memory adapter (F1) — the store's test fixture before a real host exists. */
export { createMemoryStorageAdapter } from './memoryStorageAdapter.ts';

/* The real, browser-backed adapter (F2). Injects its IDBFactory — see the file. */
export {
  createIndexedDbStorageAdapter,
  type IndexedDbStorageAdapterOptions,
} from './indexedDbStorageAdapter.ts';

/*
 * The desktop-shaped fake (F4) — JSON text column + binary column, the
 * serialization family Phase J's SQLite adapter belongs to and neither adapter
 * above exercises. A test fixture, not a host adapter: nothing in `apps/web`
 * constructs it.
 */
export {
  createDesktopShapedStorageAdapter,
  type DesktopAssetRow,
  type DesktopDocumentRow,
  type DesktopShapedStorageAdapterOptions,
  type DesktopTables,
} from './desktopShapedStorageAdapter.ts';

/**
 * `storageAdapter.contract.ts` (the shared test suite every adapter runs) is
 * DELIBERATELY not exported here. It imports `vitest`, a devDependency; barrel
 * re-exporting it would make any real consumer of this package's public API
 * (`@vpb/state`, `apps/web`) statically pull test infrastructure into their
 * module graph. Adapters import it directly by relative path from their own
 * `__tests__` files instead.
 */
