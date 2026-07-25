import type { Asset, AssetId, DocumentFile, ProjectId } from '@vpb/core';
import {
  BASE_BREAKPOINT_ID,
  createAssetLibrary,
  createDeterministicIdFactory,
  createDocumentFile,
  createProject,
  nodeScope,
  px,
  setAssets,
  setProperty,
  setStyles,
  target,
  unsafeId,
} from '@vpb/core';
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

    it('lists stored asset ids and omits deleted ones', async () => {
      const adapter = makeAdapter();
      const bytes = () => new Blob(['x'], { type: 'text/plain' });
      const idB = unsafeId<AssetId>('asset-b');

      const before = await adapter.listAssetIds();
      expect(before).toEqual({ ok: true, value: [] });

      await adapter.saveAssetBytes(assetId, bytes(), 'text/plain');
      await adapter.saveAssetBytes(idB, bytes(), 'text/plain');

      const after = await adapter.listAssetIds();
      expect(after.ok).toBe(true);
      if (after.ok) expect([...after.value].toSorted()).toEqual([assetId, idB].toSorted());

      await adapter.deleteAssetBytes(assetId);
      const pruned = await adapter.listAssetIds();
      expect(pruned).toEqual({ ok: true, value: [idB] });
    });

    it('round-trips a REAL project document with no field added or lost', async () => {
      // The fixtures above are hand-written minimal literals, which can only
      // prove an adapter round-trips the shape the TEST invented. This one is
      // built through `@vpb/core`'s own public API and `createDocumentFile` —
      // the exact call `@vpb/state`'s `save()` makes — so it carries a real node
      // tree, real default breakpoints, a real style rule and a real asset
      // record, including populated optional fields (`width`/`height`).
      //
      // `toStrictEqual`, not `toEqual`: `toEqual` treats a missing key and a key
      // whose value is `undefined` as the same thing, which is precisely the
      // difference between the two serialization families here — a structured
      // clone preserves an explicitly-`undefined` field, `JSON.stringify` drops
      // it. Under `toEqual` that divergence is invisible; under `toStrictEqual`
      // whichever adapter is wrong has to say so.
      const adapter = makeAdapter();
      const file = realDocumentFile();

      const saved = await adapter.saveDocument(file);
      expect(saved.ok).toBe(true);

      const loaded = await adapter.loadDocument(file.id);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(loaded.value).toStrictEqual(file);
    });

    it('preserves an asset mime type through the round-trip', async () => {
      // `saveAssetBytes` takes `mimeType` as its own parameter, so an adapter
      // that persists bytes in a typeless binary column (a SQLite BLOB, and the
      // desktop-shaped fake that models one) has to store it separately and
      // re-apply it when it rebuilds the `Blob`. Forgetting either half yields a
      // blob with an empty `type`, and the canvas resolver's object URL then
      // carries no content type — an image the browser refuses to paint.
      const adapter = makeAdapter();
      const bytes = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

      const saved = await adapter.saveAssetBytes(assetId, bytes, 'image/png');
      expect(saved.ok).toBe(true);

      const loaded = await adapter.loadAssetBytes(assetId);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(loaded.value.type).toBe('image/png');
    });

    it('never hands back a reference the caller holds', async () => {
      // The memory adapter's `structuredClone` exists for this, IndexedDB gets
      // it from the structured clone algorithm, and a JSON text column gets it
      // from `JSON.parse`. Stated as a CONTRACT rather than left to each
      // adapter's implementation notes: a caller that mutates what it loaded
      // must never be reaching into stored state, whatever the backing store is.
      const adapter = makeAdapter();
      const file = documentFile(idA, 'Isolated');
      await adapter.saveDocument(file);

      const first = await adapter.loadDocument(idA);
      const second = await adapter.loadDocument(idA);
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;

      expect(first.value).not.toBe(file);
      expect(first.value).not.toBe(second.value);

      // Behavioural, not merely referential: mutating one read must not be
      // observable in the next.
      (first.value as { id: string }).id = 'mutated-in-place';
      const third = await adapter.loadDocument(idA);
      expect(third).toStrictEqual({ ok: true, value: file });
    });

    it('preserves asset bytes exactly — binary fidelity, not just text', async () => {
      const adapter = makeAdapter();
      const original = new Uint8Array([0, 1, 2, 127, 128, 253, 254, 255]);
      const saved = await adapter.saveAssetBytes(
        assetId,
        new Blob([original], { type: 'application/octet-stream' }),
        'application/octet-stream',
      );
      expect(saved.ok).toBe(true);

      const loaded = await adapter.loadAssetBytes(assetId);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        const roundTripped = new Uint8Array(await loaded.value.arrayBuffer());
        expect([...roundTripped]).toEqual([...original]);
      }
    });
  });
}

/**
 * A `DocumentFile` built the way the application builds one.
 *
 * Deliberately NOT another hand-written literal: it goes through `createProject`
 * (a real page with a real node tree, the default breakpoint graph, real
 * settings), a real `setProperty` style rule, a real `Asset` with its optional
 * `width`/`height` populated, and finally `createDocumentFile` — the same call
 * `@vpb/state`'s `save()` makes. So the round-trip test above asserts on the
 * shape that actually reaches storage, not on one this file invented.
 *
 * `createDeterministicIdFactory` keeps it reproducible; the ids are irrelevant to
 * what is being proven, and a random one would make a failure harder to read.
 */
function realDocumentFile(): DocumentFile {
  const ids = createDeterministicIdFactory();
  const project = createProject('Contract Fixture', ids);
  const page = project.pages[0];
  if (!page) throw new Error('createProject always seeds a page.');

  const styled = setStyles(
    project,
    setProperty(
      project.styles,
      nodeScope(page.tree.root),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(12),
      ids,
    ),
  );

  const assetId = ids.asset();
  const asset: Asset = {
    id: assetId,
    name: 'hero.png',
    mimeType: 'image/png',
    byteSize: 2048,
    src: `asset:${assetId}`,
    width: 800,
    height: 600,
    createdAt: '2026-07-24T00:00:00.000Z',
  };

  return createDocumentFile(
    setAssets(styled, createAssetLibrary([asset])),
    '2026-07-24T12:00:00.000Z',
  );
}
