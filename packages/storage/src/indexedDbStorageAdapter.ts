import type { AssetId, DocumentFile } from '@vpb/core';

import type { DocumentSummary, StorageAdapter, StorageResult } from './storageAdapter.ts';
import { storageErr, storageOk } from './storageAdapter.ts';

/**
 * The real, browser-backed `StorageAdapter` (Phase F2).
 *
 * INJECTS ITS `IDBFactory`; never reaches for a global `indexedDB`. That is the
 * whole reason `@vpb/storage`'s Vitest project can run in **node**: the browser
 * host passes `window.indexedDB`, the tests pass `fake-indexeddb`'s factory, and
 * this file references no ambient DOM value at runtime. The moment it did, the
 * node project (where `indexedDB` is `undefined`) would fail — which is exactly
 * the headless gate `vitest.config.ts` documents, kept a RUNTIME gate even
 * though `tsconfig.base.json` already has the DOM lib types in scope.
 *
 * CANNOT THROW PAST ITS BOUNDARY. Every method resolves to a `StorageResult`;
 * an IndexedDB failure (a blocked upgrade, a quota breach, a structured-clone
 * error, a torn-down connection) is mapped to a `StorageError` kind, never
 * rethrown — the same async "cannot throw" contract the memory adapter meets
 * trivially and `storageAdapter.ts` requires of everyone.
 *
 * ONE TRANSACTION PER CALL, NO INTERLEAVED AWAITS. An IndexedDB transaction
 * auto-commits the moment the microtask queue drains without a pending request,
 * so awaiting any non-IDB promise between opening a transaction and using it
 * would silently close it (`TransactionInactiveError`). Each method therefore
 * does all of its store work synchronously inside `runInStore`, whose promise
 * resolves on `transaction.oncomplete` — the point at which the write is durable.
 */

interface StoredAsset {
  readonly bytes: Blob;
  readonly mimeType: string;
}

const DOCUMENTS = 'documents';
const ASSETS = 'assets';

export interface IndexedDbStorageAdapterOptions {
  /** Injected — `window.indexedDB` in a browser, `fake-indexeddb`'s in tests. */
  readonly factory: IDBFactory;
  readonly name?: string;
  readonly version?: number;
}

export function createIndexedDbStorageAdapter(
  options: IndexedDbStorageAdapterOptions,
): StorageAdapter {
  const { factory } = options;
  const name = options.name ?? 'vpb';
  const version = options.version ?? 1;

  // The connection is opened lazily and once. A failed open clears the cache so
  // a later call can retry rather than being stuck with a rejected promise.
  let connection: Promise<IDBDatabase> | null = null;

  function openDb(): Promise<IDBDatabase> {
    if (connection) return connection;
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, version);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DOCUMENTS)) {
          db.createObjectStore(DOCUMENTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(ASSETS)) {
          // No keyPath: the asset value is `{ bytes, mimeType }`, so the key
          // (the AssetId) is supplied out-of-line on every `put`.
          db.createObjectStore(ASSETS);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
    connection.catch(() => {
      connection = null;
    });
    return connection;
  }

  function runInStore<T>(
    db: IDBDatabase,
    store: string,
    mode: IDBTransactionMode,
    work: (objectStore: IDBObjectStore, resolveValue: (value: T) => void) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let value: T | undefined;
      let hasValue = false;

      let transaction: IDBTransaction;
      try {
        transaction = db.transaction(store, mode);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      transaction.oncomplete = () => resolve(hasValue ? (value as T) : (undefined as T));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('IndexedDB transaction error'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('IndexedDB transaction aborted'));

      work(transaction.objectStore(store), (v) => {
        value = v;
        hasValue = true;
      });
    });
  }

  return {
    async listDocuments() {
      try {
        const db = await openDb();
        const files = await runInStore<DocumentFile[]>(db, DOCUMENTS, 'readonly', (store, done) => {
          const request = store.getAll();
          request.onsuccess = () => done(request.result as DocumentFile[]);
        });
        const summaries: DocumentSummary[] = files.map((file) => ({
          id: file.id,
          name: file.project.name,
          updatedAt: file.updatedAt,
        }));
        return storageOk(summaries);
      } catch (error) {
        return mapError(error);
      }
    },

    async loadDocument(id) {
      try {
        const db = await openDb();
        const found = await runInStore<{ value: unknown } | undefined>(
          db,
          DOCUMENTS,
          'readonly',
          (store, done) => {
            const request = store.get(id);
            // Wrapped so a genuine stored `undefined` is distinguishable from a
            // missing key — though a `DocumentFile` is never `undefined`.
            request.onsuccess = () =>
              done(request.result === undefined ? undefined : { value: request.result });
          },
        );
        return found ? storageOk(found.value) : storageErr({ kind: 'not-found' });
      } catch (error) {
        return mapError(error);
      }
    },

    async saveDocument(file) {
      try {
        const db = await openDb();
        // IndexedDB structured-clones on `put` and again on `get`, so — exactly
        // like the memory adapter's explicit `structuredClone` — a caller can
        // never read back the same object reference it wrote.
        await runInStore<void>(db, DOCUMENTS, 'readwrite', (store) => {
          store.put(file);
        });
        return storageOk(undefined);
      } catch (error) {
        return mapError(error);
      }
    },

    async deleteDocument(id) {
      try {
        const db = await openDb();
        await runInStore<void>(db, DOCUMENTS, 'readwrite', (store) => {
          store.delete(id);
        });
        return storageOk(undefined);
      } catch (error) {
        return mapError(error);
      }
    },

    async saveAssetBytes(id, bytes, mimeType) {
      try {
        const db = await openDb();
        await runInStore<void>(db, ASSETS, 'readwrite', (store) => {
          store.put({ bytes, mimeType } satisfies StoredAsset, id);
        });
        return storageOk(undefined);
      } catch (error) {
        return mapError(error);
      }
    },

    async loadAssetBytes(id) {
      try {
        const db = await openDb();
        const asset = await runInStore<StoredAsset | undefined>(
          db,
          ASSETS,
          'readonly',
          (store, done) => {
            const request = store.get(id);
            request.onsuccess = () => done(request.result as StoredAsset | undefined);
          },
        );
        return asset ? storageOk(asset.bytes) : storageErr({ kind: 'not-found' });
      } catch (error) {
        return mapError(error);
      }
    },

    async deleteAssetBytes(id) {
      try {
        const db = await openDb();
        await runInStore<void>(db, ASSETS, 'readwrite', (store) => {
          store.delete(id);
        });
        return storageOk(undefined);
      } catch (error) {
        return mapError(error);
      }
    },

    async listAssetIds() {
      try {
        const db = await openDb();
        // `getAllKeys` returns the out-of-line keys supplied at `saveAssetBytes`
        // time — the AssetId strings themselves.
        const keys = await runInStore<IDBValidKey[]>(db, ASSETS, 'readonly', (store, done) => {
          const request = store.getAllKeys();
          request.onsuccess = () => done(request.result);
        });
        return storageOk(keys as AssetId[]);
      } catch (error) {
        return mapError(error);
      }
    },
  };
}

/** The name of a DOMException-shaped error, without relying on `instanceof`. */
function errorName(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const { name } = error as { name: unknown };
    if (typeof name === 'string') return name;
  }
  return undefined;
}

function mapError(error: unknown): StorageResult<never> {
  switch (errorName(error)) {
    case 'QuotaExceededError':
      return storageErr({ kind: 'quota-exceeded' });
    case 'DataCloneError':
      return storageErr({ kind: 'corrupt', detail: describe(error) });
    default:
      return storageErr({ kind: 'io-error', detail: describe(error) });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
