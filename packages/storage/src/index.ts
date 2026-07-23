/* The contract every adapter implements. */
export type {
  DocumentSummary,
  StorageAdapter,
  StorageError,
  StorageResult,
} from './storageAdapter.ts';
export { storageErr, storageOk } from './storageAdapter.ts';

/* The in-memory adapter — tests today, the desktop-shaped contract fake in F4. */
export { createMemoryStorageAdapter } from './memoryStorageAdapter.ts';

/**
 * `storageAdapter.contract.ts` (the shared test suite every adapter runs) is
 * DELIBERATELY not exported here. It imports `vitest`, a devDependency; barrel
 * re-exporting it would make any real consumer of this package's public API
 * (`@vpb/state`, `apps/web`) statically pull test infrastructure into their
 * module graph. Adapters import it directly by relative path from their own
 * `__tests__` files instead.
 */
