import type { AssetId, DocumentFile, ProjectId } from '@vpb/core';
import { unsafeId } from '@vpb/core';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { createIndexedDbStorageAdapter } from '../indexedDbStorageAdapter.ts';
import { runStorageAdapterContractTests } from '../storageAdapter.contract.ts';

/**
 * The IndexedDB adapter runs the SAME cross-adapter contract suite the memory
 * adapter runs, so the two can never silently diverge. Each `makeAdapter()` gets
 * a FRESH `IDBFactory` — fake-indexeddb isolates storage per factory instance,
 * so tests cannot leak state into one another.
 */
runStorageAdapterContractTests('indexeddb', () =>
  createIndexedDbStorageAdapter({ factory: new IDBFactory(), name: 'vpb-contract' }),
);

describe('IndexedDbStorageAdapter — implementation specifics', () => {
  const idA = unsafeId<ProjectId>('doc-a');

  const documentFile = (id: ProjectId, name: string): DocumentFile => ({
    schemaVersion: 1,
    id,
    updatedAt: '2026-07-23T00:00:00.000Z',
    project: {
      id,
      name,
      settings: {},
      pages: [],
      styles: { rules: [], classOrder: [] },
      breakpoints: [],
      assets: [],
    },
  });

  it('persists across separate adapter instances sharing a factory and name', async () => {
    // The load-bearing difference from the memory adapter: the bytes live in the
    // named database, not in a closure. A second adapter opened on the same
    // factory + name must see the first one's write.
    const factory = new IDBFactory();
    const writer = createIndexedDbStorageAdapter({ factory, name: 'vpb-shared' });
    await writer.saveDocument(documentFile(idA, 'Persisted'));

    const reader = createIndexedDbStorageAdapter({ factory, name: 'vpb-shared' });
    const loaded = await reader.loadDocument(idA);
    expect(loaded).toEqual({ ok: true, value: documentFile(idA, 'Persisted') });
  });

  it('keeps documents and assets in separate stores under the same id', async () => {
    // A document and an asset may share an id string; they must not collide,
    // which they cannot if they live in different object stores.
    const adapter = createIndexedDbStorageAdapter({
      factory: new IDBFactory(),
      name: 'vpb-stores',
    });
    const sharedId = 'same-string';
    await adapter.saveDocument(documentFile(unsafeId<ProjectId>(sharedId), 'Doc'));
    await adapter.saveAssetBytes(
      unsafeId<AssetId>(sharedId),
      new Blob(['bytes'], { type: 'text/plain' }),
      'text/plain',
    );

    const doc = await adapter.loadDocument(unsafeId<ProjectId>(sharedId));
    expect(doc.ok).toBe(true);
    if (doc.ok) expect(doc.value).toEqual(documentFile(unsafeId<ProjectId>(sharedId), 'Doc'));

    const asset = await adapter.loadAssetBytes(unsafeId<AssetId>(sharedId));
    expect(asset.ok).toBe(true);
    if (asset.ok) expect(await asset.value.text()).toBe('bytes');
  });

  it('does not hand back the same object reference it was given', async () => {
    // IndexedDB structured-clones on write and read; a caller mutating what it
    // loaded must never reach back into stored bytes.
    const adapter = createIndexedDbStorageAdapter({ factory: new IDBFactory(), name: 'vpb-clone' });
    const file = documentFile(idA, 'Original');
    await adapter.saveDocument(file);

    const loaded = await adapter.loadDocument(idA);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value).not.toBe(file);
  });

  it('maps an open failure to io-error instead of throwing', async () => {
    // "Cannot throw past its boundary": a factory whose open request errors must
    // surface as a typed StorageError, not an exception the caller must catch.
    const brokenFactory = {
      open() {
        const request = {
          result: null,
          error: new Error('boom'),
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
          onupgradeneeded: null as (() => void) | null,
          onblocked: null as (() => void) | null,
        };
        queueMicrotask(() => request.onerror?.());
        return request as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;

    const adapter = createIndexedDbStorageAdapter({ factory: brokenFactory });
    const result = await adapter.saveDocument(documentFile(idA, 'Never stored'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('io-error');
  });

  it('retries the open after a failed connection rather than caching the rejection', async () => {
    // A one-shot broken factory: the first open fails, the second succeeds. The
    // adapter must not be permanently poisoned by the first failure.
    let attempt = 0;
    const realFactory = new IDBFactory();
    const flakyFactory = {
      open(dbName: string, dbVersion?: number) {
        attempt += 1;
        if (attempt === 1) {
          const request = {
            result: null,
            error: new Error('transient'),
            onsuccess: null as (() => void) | null,
            onerror: null as (() => void) | null,
            onupgradeneeded: null as (() => void) | null,
            onblocked: null as (() => void) | null,
          };
          queueMicrotask(() => request.onerror?.());
          return request as unknown as IDBOpenDBRequest;
        }
        return realFactory.open(dbName, dbVersion);
      },
    } as unknown as IDBFactory;

    const adapter = createIndexedDbStorageAdapter({ factory: flakyFactory, name: 'vpb-flaky' });
    const first = await adapter.saveDocument(documentFile(idA, 'First try'));
    expect(first.ok).toBe(false);

    const second = await adapter.saveDocument(documentFile(idA, 'Second try'));
    expect(second.ok).toBe(true);
  });

  it('maps a non-cloneable value to corrupt', async () => {
    // Through the PUBLIC write path — no factory seam. A DocumentFile is
    // JSON-safe by construction, so a function is cast past the type to reach
    // the real DataCloneError the structured-clone algorithm raises on `put`.
    // That IS the corruption `corrupt` exists to name: bytes that cannot be
    // round-tripped through storage's clone.
    const adapter = createIndexedDbStorageAdapter({
      factory: new IDBFactory(),
      name: 'vpb-clone-error',
    });
    const base = documentFile(idA, 'Poisoned');
    const poisoned = {
      ...base,
      project: { ...base.project, settings: { bad: () => undefined } },
    } as unknown as DocumentFile;

    const result = await adapter.saveDocument(poisoned);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('corrupt');
  });

  it('maps a QuotaExceededError to quota-exceeded', async () => {
    // A JUSTIFIED SEAM: fake-indexeddb keeps everything in memory and enforces
    // no storage quota, so a real QuotaExceededError cannot be provoked from it.
    // `mapError` keys off the DOMException NAME and is operation-agnostic, so a
    // rejected request carrying that name exercises the exact mapping branch
    // under test through the adapter's public `saveDocument` — the same seam
    // shape as the broken-factory tests above.
    const quotaFactory = {
      open() {
        const request = {
          result: null,
          error: new DOMException('The quota has been exceeded.', 'QuotaExceededError'),
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
          onupgradeneeded: null as (() => void) | null,
          onblocked: null as (() => void) | null,
        };
        queueMicrotask(() => request.onerror?.());
        return request as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;

    const adapter = createIndexedDbStorageAdapter({ factory: quotaFactory });
    const result = await adapter.saveDocument(documentFile(idA, 'Too big'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('quota-exceeded');
  });
});
