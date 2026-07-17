import type { AssetId } from '../identity/ids.ts';

/**
 * An uploaded file — an image, a font, a video poster.
 *
 * METADATA ONLY. The bytes live wherever the host puts them (an Electron userData
 * folder, an object store, an IndexedDB blob); `@vpb/core` is framework-free and
 * has no filesystem, so it records what an asset IS and lets the host resolve
 * `src` to something loadable. That split is what lets the same project model load
 * in the browser and export from a Node worker.
 */
export interface Asset {
  readonly id: AssetId;
  /** Original filename, shown in the asset panel. */
  readonly name: string;
  readonly mimeType: string;
  readonly byteSize: number;
  /**
   * Host-resolvable location: an `https://` URL, a `file://` path, or an
   * opaque key. Interpreted by the host, never by core.
   */
  readonly src: string;
  /**
   * Intrinsic pixel size, images only.
   *
   * Recorded at upload because the exporter needs it to emit `width`/`height`
   * attributes — without them the browser cannot reserve space before the image
   * loads, and the page reflows as it comes in (Cumulative Layout Shift). Reading
   * it back at export would mean decoding every image again.
   */
  readonly width?: number;
  readonly height?: number;
  readonly createdAt: string;
}

export interface AssetLibrary {
  readonly assets: ReadonlyMap<AssetId, Asset>;
}

export const EMPTY_ASSET_LIBRARY: AssetLibrary = { assets: new Map() };

export function createAssetLibrary(assets: readonly Asset[] = []): AssetLibrary {
  return { assets: new Map(assets.map((asset) => [asset.id, asset])) };
}

export function getAsset(library: AssetLibrary, id: AssetId): Asset | undefined {
  return library.assets.get(id);
}

export function allAssets(library: AssetLibrary): readonly Asset[] {
  return [...library.assets.values()];
}

export function putAsset(library: AssetLibrary, asset: Asset): AssetLibrary {
  const assets = new Map(library.assets);
  assets.set(asset.id, asset);
  return { assets };
}

export function removeAsset(library: AssetLibrary, id: AssetId): AssetLibrary {
  if (!library.assets.has(id)) return library;

  const assets = new Map(library.assets);
  assets.delete(id);
  return { assets };
}

export function isImageAsset(asset: Asset): boolean {
  return asset.mimeType.startsWith('image/');
}
