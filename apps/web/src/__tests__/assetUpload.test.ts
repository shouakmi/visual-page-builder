import {
  createAssetLibrary,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createProject,
  getAsset,
  setAssets,
  unsafeId,
  type Asset,
  type AssetId,
} from '@vpb/core';
import { createEditorStore, type EditorEnvironment } from '@vpb/state';
import { createMemoryStorageAdapter, storageErr, type StorageAdapter } from '@vpb/storage';
import { describe, expect, it } from 'vitest';

import { performUpload, sortAssetsByNewest, validateUpload } from '../assetUpload.ts';

const env: EditorEnvironment = { registry: createBuiltinRegistry() };
const okDecode = async () => ({ width: 4, height: 2 });
const nullDecode = async () => null;

const png = (name: string, bytes = 8): File =>
  new File([new Uint8Array(bytes)], name, { type: 'image/png' });

function makeStore() {
  const ids = createDeterministicIdFactory();
  const project = setAssets(createProject('Test', ids), createAssetLibrary([]));
  return createEditorStore({ project, env, now: () => 0 });
}

describe('validateUpload', () => {
  it('accepts a valid image and builds its asset record', async () => {
    const result = await validateUpload(png('logo.png', 10), {
      ids: createDeterministicIdFactory(),
      decode: okDecode,
      now: () => 0,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.asset.id).toBe('asset-1'); // from the injected id factory
      expect(result.asset.name).toBe('logo.png');
      expect(result.asset.mimeType).toBe('image/png');
      expect(result.asset.byteSize).toBe(10);
      expect(result.asset.width).toBe(4);
      expect(result.asset.height).toBe(2);
      expect(result.asset.src).toBe('asset:asset-1');
    }
  });

  it('rejects an empty file', async () => {
    const result = await validateUpload(new File([], 'e.png', { type: 'image/png' }), {
      ids: createDeterministicIdFactory(),
      decode: okDecode,
    });
    expect(result).toEqual({ ok: false, failure: { kind: 'empty' } });
  });

  it('rejects a file over the size limit', async () => {
    const result = await validateUpload(png('big.png', 100), {
      ids: createDeterministicIdFactory(),
      decode: okDecode,
      maxBytes: 10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toEqual({ kind: 'too-large', maxBytes: 10 });
  });

  it('rejects an SVG as an unsupported type', async () => {
    const svg = new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' });
    const result = await validateUpload(svg, {
      ids: createDeterministicIdFactory(),
      decode: okDecode,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('unsupported-type');
  });

  it('rejects a non-image type', async () => {
    const pdf = new File([new Uint8Array(4)], 'x.pdf', { type: 'application/pdf' });
    const result = await validateUpload(pdf, {
      ids: createDeterministicIdFactory(),
      decode: okDecode,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('unsupported-type');
  });

  it('rejects a file that does not decode as an image (spoofed type)', async () => {
    const result = await validateUpload(png('fake.png', 8), {
      ids: createDeterministicIdFactory(),
      decode: nullDecode,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('undecodable');
  });
});

describe('performUpload', () => {
  it('stores the bytes, then records the add command', async () => {
    const store = makeStore();
    const adapter = createMemoryStorageAdapter();

    const outcome = await performUpload(png('a.png', 8), {
      store,
      adapter,
      ids: createDeterministicIdFactory(),
      decode: okDecode,
      now: () => 0,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(getAsset(store.getState().present.project.assets, outcome.asset.id)).toEqual(
        outcome.asset,
      );
      const stored = await adapter.loadAssetBytes(outcome.asset.id);
      expect(stored.ok).toBe(true);
      expect(store.getState().history.past).toHaveLength(1);
    }
  });

  it('records no metadata when storing the bytes fails (bytes-first recovery)', async () => {
    const store = makeStore();
    const failing: StorageAdapter = {
      ...createMemoryStorageAdapter(),
      saveAssetBytes: async () => storageErr({ kind: 'quota-exceeded' }),
    };

    const outcome = await performUpload(png('a.png', 8), {
      store,
      adapter: failing,
      ids: createDeterministicIdFactory(),
      decode: okDecode,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.kind).toBe('io-error');
    // Nothing reached the model: no metadata, no history entry.
    expect(store.getState().present.project.assets.assets.size).toBe(0);
    expect(store.getState().history.past).toHaveLength(0);
  });

  it('allows duplicate filenames, minting distinct ids', async () => {
    const store = makeStore();
    const adapter = createMemoryStorageAdapter();
    const ids = createDeterministicIdFactory();

    const a = await performUpload(png('same.png', 8), { store, adapter, ids, decode: okDecode });
    const b = await performUpload(png('same.png', 8), { store, adapter, ids, decode: okDecode });

    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.asset.id).not.toBe(b.asset.id);
      expect(store.getState().present.project.assets.assets.size).toBe(2);
    }
  });
});

describe('sortAssetsByNewest', () => {
  it('orders assets newest first by createdAt', () => {
    const mk = (id: string, ts: string): Asset => ({
      id: unsafeId<AssetId>(id),
      name: id,
      mimeType: 'image/png',
      byteSize: 1,
      src: `asset:${id}`,
      createdAt: ts,
    });

    const sorted = sortAssetsByNewest([
      mk('old', '2026-01-01T00:00:00.000Z'),
      mk('new', '2026-12-01T00:00:00.000Z'),
      mk('mid', '2026-06-01T00:00:00.000Z'),
    ]);

    expect(sorted.map((asset) => asset.id)).toEqual(['new', 'mid', 'old']);
  });
});
