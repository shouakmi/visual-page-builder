import {
  allAssets,
  createAssetLibrary,
  type Asset,
  type AssetId,
  type AssetLibrary,
} from '@vpb/core';
import type { StorageResult } from '@vpb/storage';

/**
 * The host-side asset resolver (Phase F3, Slice C).
 *
 * The renderer resolves an image by reading `asset.src` and passing it through
 * `isSafeUrl`, but a MANAGED asset's persisted `src` is the opaque `asset:<id>`
 * key, not a loadable URL. This resolver bridges that gap in the ONE place the
 * browser-only `URL.createObjectURL` belongs — the host — keeping `@vpb/core`
 * byte-free and the renderer unchanged.
 *
 * OBJECT-URL LIFECYCLE, owned end to end here:
 *  - CREATED on the first resolve of a managed asset whose bytes load.
 *  - CACHED per AssetId — sound because F3's bytes are immutable under an id, so a
 *    given asset's URL never needs to change; resolving it again reuses the URL.
 *  - REVOKED when the asset leaves the library (eviction) and when the resolver is
 *    disposed. An unrevoked object URL is a real memory leak.
 *  - NEVER LEAKED ON FAILURE. A missing/failed load creates nothing; a dispose
 *    that races an in-flight load creates nothing (the load checks `disposed`
 *    before minting a URL).
 *
 * A persisted `blob:` URL would be a dangling capability after reload, so it is
 * never written back to the model — only the in-memory resolved library carries
 * it. The document always stores the opaque `asset:<id>`.
 */

export const MANAGED_ASSET_SCHEME = 'asset:';

/** The persisted `src` of a managed asset. Slice E's upload writes this. */
export function managedAssetSrc(id: AssetId): string {
  return `${MANAGED_ASSET_SCHEME}${id}`;
}

function isManagedSrc(src: string): boolean {
  return src.startsWith(MANAGED_ASSET_SCHEME);
}

export interface AssetResolverOptions {
  readonly loadBytes: (id: AssetId) => Promise<StorageResult<Blob>>;
  /** Injected so the object-URL lifecycle is driven in tests without a real DOM. */
  readonly createObjectURL?: (blob: Blob) => string;
  readonly revokeObjectURL?: (url: string) => void;
}

export interface AssetResolver {
  /**
   * An AssetLibrary whose managed assets carry a live `blob:` src. Assets whose
   * bytes are missing are left unresolved (their opaque src) rather than throwing,
   * so the renderer degrades to no `src`. Never rejects.
   */
  resolve(library: AssetLibrary): Promise<AssetLibrary>;
  /** Revoke every object URL and stop resolving. Idempotent. */
  dispose(): void;
}

export function createAssetResolver(options: AssetResolverOptions): AssetResolver {
  const { loadBytes } = options;
  const createUrl = options.createObjectURL ?? ((blob) => URL.createObjectURL(blob));
  const revokeUrl = options.revokeObjectURL ?? ((url) => URL.revokeObjectURL(url));

  // Keyed by AssetId; the value is the in-flight-or-resolved load, so concurrent
  // resolves of the same asset share a single createObjectURL.
  const cache = new Map<AssetId, Promise<string | null>>();
  let disposed = false;

  function ensureUrl(id: AssetId): Promise<string | null> {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;

    const pending = loadBytes(id)
      .then((result) => {
        // A missing load OR a dispose that raced it: create nothing, leak nothing.
        if (disposed || !result.ok) return null;
        return createUrl(result.value);
      })
      .catch(() => null);
    cache.set(id, pending);
    return pending;
  }

  function revokeEntry(pending: Promise<string | null>): void {
    void pending.then((url) => {
      if (url) revokeUrl(url);
    });
  }

  return {
    async resolve(library) {
      const present = new Set<AssetId>();
      const resolved: Asset[] = [];

      for (const asset of allAssets(library)) {
        present.add(asset.id);
        if (!isManagedSrc(asset.src)) {
          resolved.push(asset); // external — nothing to load
          continue;
        }
        const url = await ensureUrl(asset.id);
        resolved.push(url === null ? asset : { ...asset, src: url });
      }

      // Evict object URLs for assets no longer present, so repeated resolves
      // cannot accumulate dead URLs.
      for (const [id, pending] of cache) {
        if (!present.has(id)) {
          cache.delete(id);
          revokeEntry(pending);
        }
      }

      return createAssetLibrary(resolved);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const pending of cache.values()) revokeEntry(pending);
      cache.clear();
    },
  };
}
