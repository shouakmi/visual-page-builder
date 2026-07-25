import type { AssetId, DocumentFile, ProjectId } from '@vpb/core';
import { unsafeId } from '@vpb/core';
import { describe, expect, it } from 'vitest';

import type {
  DesktopAssetRow,
  DesktopDocumentRow,
  DesktopTables,
} from '../desktopShapedStorageAdapter.ts';
import { createDesktopShapedStorageAdapter } from '../desktopShapedStorageAdapter.ts';
import { runStorageAdapterContractTests } from '../storageAdapter.contract.ts';

/**
 * The desktop-shaped fake runs the SAME cross-adapter contract suite the memory
 * and IndexedDB adapters run — the third arm of the guarantee that no two
 * adapters silently diverge.
 *
 * Its value is that it diverges from both in the one dimension they SHARE: they
 * both round-trip through the structured clone algorithm, so the contract has
 * never been proven against the serialization model a real SQLite adapter uses
 * (a JSON text column plus a binary column). See the adapter's own file comment.
 *
 * Each `makeAdapter()` gets a fresh instance; there is no shared backing store.
 */
runStorageAdapterContractTests('desktopShaped', () => createDesktopShapedStorageAdapter());

/**
 * A table that fails the way a driver fails: the statement throws and NOTHING is
 * written. Armed after seeding, so a test can prove a failed write left already
 * persisted rows untouched rather than half-updated.
 *
 * A `Map` subclass rather than a new interface, because `DesktopTables` is
 * deliberately two plain `Map`s — the seam stays a real data structure the
 * adapter uses, not an abstraction invented for the tests.
 */
class FailingTable<K, V> extends Map<K, V> {
  failOnWrite: unknown = null;
  failOnRead: unknown = null;

  override set(key: K, value: V): this {
    if (this.failOnWrite !== null) throw this.failOnWrite;
    return super.set(key, value);
  }

  override get(key: K): V | undefined {
    if (this.failOnRead !== null) throw this.failOnRead;
    return super.get(key);
  }
}

/** A driver error: an `Error` carrying a SQLite result code, as a driver throws. */
function driverError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('DesktopShapedStorageAdapter — implementation specifics', () => {
  const idA = unsafeId<ProjectId>('doc-a');
  const idB = unsafeId<ProjectId>('doc-b');
  const assetA = unsafeId<AssetId>('asset-a');
  const assetB = unsafeId<AssetId>('asset-b');

  const documentFile = (id: ProjectId, name: string): DocumentFile => ({
    schemaVersion: 1,
    id,
    updatedAt: '2026-07-24T00:00:00.000Z',
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

  function failingTables(): {
    tables: DesktopTables;
    documents: FailingTable<ProjectId, DesktopDocumentRow>;
    assets: FailingTable<AssetId, DesktopAssetRow>;
  } {
    const documents = new FailingTable<ProjectId, DesktopDocumentRow>();
    const assets = new FailingTable<AssetId, DesktopAssetRow>();
    return { tables: { documents, assets }, documents, assets };
  }

  it('maps a full-disk driver error to quota-exceeded and writes no partial row', async () => {
    const { tables, documents } = failingTables();
    const adapter = createDesktopShapedStorageAdapter({ tables });
    await adapter.saveDocument(documentFile(idA, 'Already safe'));

    documents.failOnWrite = driverError('SQLITE_FULL', 'database or disk is full');
    const result = await adapter.saveDocument(documentFile(idB, 'Never stored'));
    expect(result).toEqual({ ok: false, error: { kind: 'quota-exceeded' } });

    // ATOMIC: the failed write left no trace, and did not disturb what was there.
    documents.failOnWrite = null;
    expect(await adapter.loadDocument(idB)).toEqual({ ok: false, error: { kind: 'not-found' } });
    expect(await adapter.loadDocument(idA)).toEqual({
      ok: true,
      value: documentFile(idA, 'Already safe'),
    });
    const listed = await adapter.listDocuments();
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.value.map((d) => d.id)).toEqual([idA]);
  });

  it('maps a corrupt-database driver error to corrupt', async () => {
    const { tables, documents } = failingTables();
    const adapter = createDesktopShapedStorageAdapter({ tables });
    await adapter.saveDocument(documentFile(idA, 'Readable'));

    documents.failOnRead = driverError('SQLITE_CORRUPT', 'database disk image is malformed');
    const result = await adapter.loadDocument(idA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('corrupt');
  });

  it('maps an unrecognised driver error to io-error and writes no partial row', async () => {
    const { tables, documents } = failingTables();
    const adapter = createDesktopShapedStorageAdapter({ tables });
    await adapter.saveDocument(documentFile(idA, 'Already safe'));

    // No `code` at all — the honest default, never guessed at as something the
    // host would act on differently.
    documents.failOnWrite = new Error('connection lost');
    const result = await adapter.saveDocument(documentFile(idB, 'Never stored'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('io-error');

    documents.failOnWrite = null;
    expect(await adapter.loadDocument(idB)).toEqual({ ok: false, error: { kind: 'not-found' } });
    expect(await adapter.loadDocument(idA)).toEqual({
      ok: true,
      value: documentFile(idA, 'Already safe'),
    });
  });

  it('reports corrupt for stored text that will not parse', async () => {
    // Injected directly: no public write path can produce an unparseable payload,
    // so the tables seam is the only honest way to reach this branch. `corrupt`
    // and not `not-found` — the row EXISTS, and the host has to be able to tell a
    // damaged document from a missing one.
    const { tables, documents } = failingTables();
    documents.set(idA, {
      id: idA,
      name: 'Damaged',
      updatedAt: '2026-07-24T00:00:00.000Z',
      payload: '{"schemaVersion":1,"project":',
    });

    const adapter = createDesktopShapedStorageAdapter({ tables });
    const result = await adapter.loadDocument(idA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('corrupt');
  });

  it('lists documents from the persisted columns, not by parsing each payload', async () => {
    // A damaged payload must not take the document LIST down with it: a real
    // adapter runs `SELECT id, name, updated_at`, which never touches the blob.
    // If this fake parsed payloads to list them, Phase J could not copy it — and
    // a user with one corrupt document would see an empty project manager.
    const { tables, documents } = failingTables();
    documents.set(idA, {
      id: idA,
      name: 'Damaged but listed',
      updatedAt: '2026-07-24T00:00:00.000Z',
      payload: 'not json at all',
    });

    const adapter = createDesktopShapedStorageAdapter({ tables });
    await adapter.saveDocument(documentFile(idB, 'Healthy'));

    const listed = await adapter.listDocuments();
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      const sorted = [...listed.value].toSorted((a, b) => a.id.localeCompare(b.id));
      expect(sorted).toEqual([
        { id: idA, name: 'Damaged but listed', updatedAt: '2026-07-24T00:00:00.000Z' },
        { id: idB, name: 'Healthy', updatedAt: '2026-07-24T00:00:00.000Z' },
      ]);
    }
  });

  it('leaves a good row intact when the replacing payload cannot be serialized', async () => {
    // THE ORDERING TEST. The payload is serialized BEFORE the row is written, so
    // a document that cannot be represented as JSON fails without touching the
    // good version already stored under that id. Write-then-serialize would
    // destroy the user's last good save to store nothing in its place.
    const adapter = createDesktopShapedStorageAdapter();
    const good = documentFile(idA, 'Last good save');
    await adapter.saveDocument(good);

    const cyclic = { ...documentFile(idA, 'Cyclic') } as DocumentFile & { self?: unknown };
    cyclic.self = cyclic;

    const result = await adapter.saveDocument(cyclic);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('corrupt');

    expect(await adapter.loadDocument(idA)).toEqual({ ok: true, value: good });
  });

  it('stores asset bytes in a binary column beside a mime-type column', async () => {
    // The desktop divergence made visible: the row holds raw bytes, not a `Blob`.
    // A `Blob` is what a structured-clone store keeps; a BLOB column cannot, so
    // the type has to travel in its own column or it is lost.
    const { tables, assets } = failingTables();
    const adapter = createDesktopShapedStorageAdapter({ tables });
    const original = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    await adapter.saveAssetBytes(assetA, new Blob([original], { type: 'image/png' }), 'image/png');

    const row = assets.get(assetA);
    expect(row).toBeDefined();
    expect(row?.bytes).toBeInstanceOf(Uint8Array);
    expect(row?.mimeType).toBe('image/png');
    if (row) expect([...row.bytes]).toEqual([...original]);
  });

  it('maps a full-disk error on an asset write to quota-exceeded, keeping stored bytes', async () => {
    const { tables, assets } = failingTables();
    const adapter = createDesktopShapedStorageAdapter({ tables });
    await adapter.saveAssetBytes(
      assetA,
      new Blob(['keep me'], { type: 'text/plain' }),
      'text/plain',
    );

    assets.failOnWrite = driverError('SQLITE_FULL', 'database or disk is full');
    const result = await adapter.saveAssetBytes(
      assetB,
      new Blob(['too big'], { type: 'text/plain' }),
      'text/plain',
    );
    expect(result).toEqual({ ok: false, error: { kind: 'quota-exceeded' } });

    // ATOMIC: the failed asset write is not enumerable and did not evict the
    // bytes already stored — byte GC would otherwise reap a half-written id.
    assets.failOnWrite = null;
    const ids = await adapter.listAssetIds();
    expect(ids).toEqual({ ok: true, value: [assetA] });

    const kept = await adapter.loadAssetBytes(assetA);
    expect(kept.ok).toBe(true);
    if (kept.ok) expect(await kept.value.text()).toBe('keep me');
  });
});
