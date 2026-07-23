import type { AssetId, DocumentFile, ProjectId } from '@vpb/core';
import { unsafeId } from '@vpb/core';
import { describe, expect, it } from 'vitest';

import type { StorageAdapter } from './storageAdapter.ts';

/**
 * THE CROSS-ADAPTER CONTRACT SUITE.
 *
 * Every `StorageAdapter` implementation runs this SAME suite from its own test
 * file — `memoryStorageAdapter.test.ts` today, `indexedDbStorageAdapter.test.ts`
 * in F2 — so two adapters can never silently diverge in behaviour. This is the
 * "adapters are untrusted" testing philosophy `@vpb/ui`'s `ThemeStorage` suite
 * already established, generalised across implementations rather than across
 * failure modes of one.
 *
 * Not itself a `.test.ts` file (the vitest config only picks up
 * `src/**\/*.test.ts`) — it is imported and CALLED by one, the same shape as
 * any other shared test helper in this codebase.
 */
export function runStorageAdapterContractTests(
  name: string,
  makeAdapter: () => StorageAdapter,
): void {
  describe(`StorageAdapter contract — ${name}`, () => {
    const idA = unsafeId<ProjectId>('doc-a');
    const idB = unsafeId<ProjectId>('doc-b');
    const missingId = unsafeId<ProjectId>('doc-missing');
    const assetId = unsafeId<AssetId>('asset-a');
    const missingAssetId = unsafeId<AssetId>('asset-missing');

    const documentFile = (id: ProjectId, name: string): DocumentFile => ({
      schemaVersion: 1,
      id,
      updatedAt: '2026-07-22T00:00:00.000Z',
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

    it('saves and loads a document', async () => {
      const adapter = makeAdapter();
      const file = documentFile(idA, 'Contract Test');

      const saved = await adapter.saveDocument(file);
      expect(saved.ok).toBe(true);

      const loaded = await adapter.loadDocument(idA);
      expect(loaded).toEqual({ ok: true, value: file });
    });

    it('reports not-found for an unknown document', async () => {
      const adapter = makeAdapter();
      const loaded = await adapter.loadDocument(missingId);
      expect(loaded).toEqual({ ok: false, error: { kind: 'not-found' } });
    });

    it('reports not-found after deleting a document', async () => {
      const adapter = makeAdapter();
      await adapter.saveDocument(documentFile(idA, 'Contract Test'));

      const deleted = await adapter.deleteDocument(idA);
      expect(deleted.ok).toBe(true);

      const loaded = await adapter.loadDocument(idA);
      expect(loaded).toEqual({ ok: false, error: { kind: 'not-found' } });
    });

    it('lists saved documents and omits deleted ones', async () => {
      const adapter = makeAdapter();
      await adapter.saveDocument(documentFile(idA, 'A'));
      await adapter.saveDocument(documentFile(idB, 'B'));

      const before = await adapter.listDocuments();
      expect(before.ok).toBe(true);
      if (before.ok) {
        const sorted = [...before.value].toSorted((a, b) => a.id.localeCompare(b.id));
        expect(sorted).toEqual([
          { id: idA, name: 'A', updatedAt: '2026-07-22T00:00:00.000Z' },
          { id: idB, name: 'B', updatedAt: '2026-07-22T00:00:00.000Z' },
        ]);
      }

      await adapter.deleteDocument(idA);

      const after = await adapter.listDocuments();
      expect(after.ok).toBe(true);
      if (after.ok) expect(after.value.map((d) => d.id)).toEqual([idB]);
    });

    it('overwrites a document saved under the same id', async () => {
      const adapter = makeAdapter();
      await adapter.saveDocument(documentFile(idA, 'First'));
      const updated = { ...documentFile(idA, 'First'), updatedAt: '2026-07-23T00:00:00.000Z' };
      await adapter.saveDocument(updated);

      const loaded = await adapter.loadDocument(idA);
      expect(loaded).toEqual({ ok: true, value: updated });
    });

    it('saves, loads, and deletes asset bytes', async () => {
      const adapter = makeAdapter();
      const bytes = new Blob(['hello'], { type: 'text/plain' });

      const saved = await adapter.saveAssetBytes(assetId, bytes, 'text/plain');
      expect(saved.ok).toBe(true);

      const loaded = await adapter.loadAssetBytes(assetId);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(await loaded.value.text()).toBe('hello');

      const deleted = await adapter.deleteAssetBytes(assetId);
      expect(deleted.ok).toBe(true);

      const afterDelete = await adapter.loadAssetBytes(assetId);
      expect(afterDelete).toEqual({ ok: false, error: { kind: 'not-found' } });
    });

    it('reports not-found for unknown asset bytes', async () => {
      const adapter = makeAdapter();
      const loaded = await adapter.loadAssetBytes(missingAssetId);
      expect(loaded).toEqual({ ok: false, error: { kind: 'not-found' } });
    });
  });
}
