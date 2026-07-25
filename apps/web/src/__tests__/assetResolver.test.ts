import { createAssetLibrary, getAsset, unsafeId, type Asset, type AssetId } from '@vpb/core';
import type { StorageResult } from '@vpb/storage';
import { describe, expect, it } from 'vitest';

import { createAssetResolver, managedAssetSrc } from '../assetResolver.ts';

/** A counting object-URL factory, so the lifecycle is observed, not assumed. */
function fakeUrls() {
  let n = 0;
  const created: string[] = [];
  const revoked: string[] = [];
  return {
    createObjectURL: (_blob: Blob): string => {
      const url = `blob:mock/${(n += 1)}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url: string): void => {
      revoked.push(url);
    },
    created,
    revoked,
    /** URLs created but not yet revoked. */
    get live(): string[] {
      return created.filter((url) => !revoked.includes(url));
    },
  };
}

/** A loader backed by a fixed map; unknown ids resolve to `not-found`. */
function loaderFor(store: Record<string, string>) {
  return async (id: AssetId): Promise<StorageResult<Blob>> => {
    const content = store[id];
    return content === undefined
      ? { ok: false, error: { kind: 'not-found' } }
      : { ok: true, value: new Blob([content]) };
  };
}

const managed = (id: string): Asset => ({
  id: unsafeId<AssetId>(id),
  name: `${id}.png`,
  mimeType: 'image/png',
  byteSize: 3,
  src: managedAssetSrc(unsafeId<AssetId>(id)),
  createdAt: '2026-07-24T00:00:00.000Z',
});

/**
 * Revocation is async by design — it awaits the cached load promise so in-flight
 * loads and already-resolved URLs revoke through one path. A flush lets those
 * microtasks run before assertions that follow a synchronous `dispose()`.
 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createAssetResolver — object URL lifecycle', () => {
  it('creates an object URL and resolves a managed asset to it', async () => {
    const urls = fakeUrls();
    const resolver = createAssetResolver({
      loadBytes: loaderFor({ a: 'hello' }),
      createObjectURL: urls.createObjectURL,
      revokeObjectURL: urls.revokeObjectURL,
    });

    const out = await resolver.resolve(createAssetLibrary([managed('a')]));

    expect(getAsset(out, unsafeId<AssetId>('a'))?.src).toBe('blob:mock/1');
    expect(urls.created).toHaveLength(1);
    resolver.dispose();
  });

  it('reuses one object URL across repeated resolves of the same asset', async () => {
    const urls = fakeUrls();
    const resolver = createAssetResolver({
      loadBytes: loaderFor({ a: 'hello' }),
      createObjectURL: urls.createObjectURL,
      revokeObjectURL: urls.revokeObjectURL,
    });
    const library = createAssetLibrary([managed('a')]);

    await resolver.resolve(library);
    await resolver.resolve(library);
    await resolver.resolve(library);

    expect(urls.created).toHaveLength(1); // cached, not re-created
    resolver.dispose();
  });

  it('revokes every object URL on dispose', async () => {
    const urls = fakeUrls();
    const resolver = createAssetResolver({
      loadBytes: loaderFor({ a: 'x', b: 'y' }),
      createObjectURL: urls.createObjectURL,
      revokeObjectURL: urls.revokeObjectURL,
    });

    await resolver.resolve(createAssetLibrary([managed('a'), managed('b')]));
    expect(urls.live).toHaveLength(2);

    resolver.dispose();
    await flush();
    expect(urls.live).toHaveLength(0);
    expect(urls.revoked.toSorted()).toEqual(urls.created.toSorted());
  });

  it('does not leak object URLs across repeated resolve/dispose cycles', async () => {
    const urls = fakeUrls();

    for (let i = 0; i < 5; i += 1) {
      const resolver = createAssetResolver({
        loadBytes: loaderFor({ a: 'x' }),
        createObjectURL: urls.createObjectURL,
        revokeObjectURL: urls.revokeObjectURL,
      });
      await resolver.resolve(createAssetLibrary([managed('a')]));
      resolver.dispose();
    }
    await flush();

    expect(urls.created).toHaveLength(5);
    expect(urls.revoked).toHaveLength(5);
    expect(urls.live).toHaveLength(0);
  });

  it('revokes the object URL of an asset dropped from the library', async () => {
    const urls = fakeUrls();
    const resolver = createAssetResolver({
      loadBytes: loaderFor({ a: 'x', b: 'y' }),
      createObjectURL: urls.createObjectURL,
      revokeObjectURL: urls.revokeObjectURL,
    });

    await resolver.resolve(createAssetLibrary([managed('a'), managed('b')]));
    expect(urls.live).toHaveLength(2);

    await resolver.resolve(createAssetLibrary([managed('a')])); // b removed
    expect(urls.live).toEqual(['blob:mock/1']); // b's URL revoked, a's kept

    resolver.dispose();
  });

  it('leaves an asset unresolved when its bytes are missing, without throwing', async () => {
    const urls = fakeUrls();
    const resolver = createAssetResolver({
      loadBytes: loaderFor({}), // nothing stored → not-found
      createObjectURL: urls.createObjectURL,
      revokeObjectURL: urls.revokeObjectURL,
    });

    const out = await resolver.resolve(createAssetLibrary([managed('gone')]));

    // The opaque key survives, so the renderer degrades to no `src`.
    expect(getAsset(out, unsafeId<AssetId>('gone'))?.src).toBe(
      managedAssetSrc(unsafeId<AssetId>('gone')),
    );
    expect(urls.created).toHaveLength(0);
    resolver.dispose();
  });

  it('does not crash when the loader itself rejects, and creates nothing', async () => {
    const urls = fakeUrls();
    const resolver = createAssetResolver({
      loadBytes: async () => {
        throw new Error('adapter blew up');
      },
      createObjectURL: urls.createObjectURL,
      revokeObjectURL: urls.revokeObjectURL,
    });

    const out = await resolver.resolve(createAssetLibrary([managed('a')]));

    expect(getAsset(out, unsafeId<AssetId>('a'))?.src).toBe(
      managedAssetSrc(unsafeId<AssetId>('a')),
    );
    expect(urls.created).toHaveLength(0);
    resolver.dispose();
  });

  it('creates no object URL when disposed mid-load, leaving nothing to leak', async () => {
    const urls = fakeUrls();
    let release!: (value: StorageResult<Blob>) => void;
    const resolver = createAssetResolver({
      loadBytes: () => new Promise<StorageResult<Blob>>((resolve) => (release = resolve)),
      createObjectURL: urls.createObjectURL,
      revokeObjectURL: urls.revokeObjectURL,
    });

    const pending = resolver.resolve(createAssetLibrary([managed('a')]));
    resolver.dispose(); // before the load resolves
    release({ ok: true, value: new Blob(['x']) });
    await pending;

    expect(urls.created).toHaveLength(0); // the disposed guard prevented creation
    expect(urls.live).toHaveLength(0);
  });

  it('passes external (non-managed) srcs through untouched', async () => {
    const urls = fakeUrls();
    const resolver = createAssetResolver({
      loadBytes: loaderFor({}),
      createObjectURL: urls.createObjectURL,
      revokeObjectURL: urls.revokeObjectURL,
    });
    const external: Asset = { ...managed('ext'), src: 'https://cdn.example.com/logo.png' };

    const out = await resolver.resolve(createAssetLibrary([external]));

    expect(getAsset(out, unsafeId<AssetId>('ext'))?.src).toBe('https://cdn.example.com/logo.png');
    expect(urls.created).toHaveLength(0);
    resolver.dispose();
  });
});
