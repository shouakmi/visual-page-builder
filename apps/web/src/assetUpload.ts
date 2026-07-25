import type { Asset, IdFactory } from '@vpb/core';
import { addAssetCommand, type EditorStore } from '@vpb/state';
import type { StorageAdapter, StorageError } from '@vpb/storage';
import type { StoreApi } from 'zustand';

import { managedAssetSrc } from './assetResolver.ts';

/**
 * Upload validation and orchestration (Phase F3, Slice E).
 *
 * VALIDATION IS THE HOST'S JOB. Only the browser has the `File` API and an image
 * decoder, so size/type/emptiness/corruption checks live here, never in
 * `@vpb/core`. Core validates STRUCTURE (the `Asset` record's shape on
 * deserialize); the host validates CONTENT.
 *
 * BYTES-FIRST ORDERING. `performUpload` writes the blob to the adapter BEFORE it
 * records the metadata command, so the library can never hold a record for bytes
 * that were never stored. If the byte write fails, no command runs — there is
 * nothing to undo and nothing orphaned in the model.
 *
 * SVG is rejected by omission from the accepted set: it is a document format that
 * can carry a script, and an inline/background SVG is a real XSS vector. Only
 * rasters the render/export path already treats as safe are accepted — the same
 * set `isSafeUrl` whitelists for `data:` images.
 */

export const MAX_ASSET_BYTES = 25 * 1024 * 1024; // 25 MB

export const ACCEPTED_IMAGE_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
];

export type UploadFailure =
  | { readonly kind: 'empty' }
  | { readonly kind: 'too-large'; readonly maxBytes: number }
  | { readonly kind: 'unsupported-type'; readonly mimeType: string }
  | { readonly kind: 'undecodable' }
  | { readonly kind: 'io-error'; readonly detail: string };

export interface UploadOptions {
  readonly ids: IdFactory;
  readonly now?: () => number;
  /** Injected image decoder: intrinsic size, or null if the bytes do not decode. */
  readonly decode: (blob: Blob) => Promise<{ width: number; height: number } | null>;
  readonly maxBytes?: number;
}

export type ValidationResult =
  | { readonly ok: true; readonly asset: Asset; readonly blob: Blob }
  | { readonly ok: false; readonly failure: UploadFailure };

/** Validate a file and, if it passes, build its (not-yet-stored) `Asset` record. */
export async function validateUpload(
  file: File,
  options: UploadOptions,
): Promise<ValidationResult> {
  const maxBytes = options.maxBytes ?? MAX_ASSET_BYTES;
  const now = options.now ?? (() => Date.now());

  if (file.size === 0) return { ok: false, failure: { kind: 'empty' } };
  if (file.size > maxBytes) return { ok: false, failure: { kind: 'too-large', maxBytes } };
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return { ok: false, failure: { kind: 'unsupported-type', mimeType: file.type } };
  }

  // Decode to prove the bytes are a real image (defeating a spoofed MIME) and to
  // record intrinsic width/height once, so the exporter can emit them without
  // decoding again.
  const size = await options.decode(file);
  if (!size) return { ok: false, failure: { kind: 'undecodable' } };

  const id = options.ids.asset();
  const asset: Asset = {
    id,
    name: file.name,
    mimeType: file.type,
    byteSize: file.size,
    src: managedAssetSrc(id),
    width: size.width,
    height: size.height,
    createdAt: new Date(now()).toISOString(),
  };
  return { ok: true, asset, blob: file };
}

export interface PerformUploadOptions extends UploadOptions {
  readonly store: StoreApi<EditorStore>;
  readonly adapter: StorageAdapter;
}

export type UploadOutcome =
  | { readonly ok: true; readonly asset: Asset }
  | { readonly ok: false; readonly failure: UploadFailure };

/** Validate, store the bytes, then record the metadata command — in that order. */
export async function performUpload(
  file: File,
  options: PerformUploadOptions,
): Promise<UploadOutcome> {
  const validated = await validateUpload(file, options);
  if (!validated.ok) return validated;

  const saved = await options.adapter.saveAssetBytes(
    validated.asset.id,
    validated.blob,
    validated.asset.mimeType,
  );
  if (!saved.ok) {
    return { ok: false, failure: { kind: 'io-error', detail: describeStorageError(saved.error) } };
  }

  options.store.getState().execute(addAssetCommand(validated.asset));
  return { ok: true, asset: validated.asset };
}

/** Newest first — a stable, deterministic display order for the asset panel. */
export function sortAssetsByNewest(assets: readonly Asset[]): readonly Asset[] {
  return [...assets].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
}

/** The default browser decoder; tests inject their own. */
export async function decodeImageSize(
  blob: Blob,
): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

function describeStorageError(error: StorageError): string {
  switch (error.kind) {
    case 'quota-exceeded':
      return 'Storage is full.';
    case 'io-error':
      return error.detail;
    case 'corrupt':
      return error.detail;
    case 'not-found':
      return 'Not found.';
  }
}

export function describeUploadFailure(failure: UploadFailure): string {
  switch (failure.kind) {
    case 'empty':
      return 'The file is empty.';
    case 'too-large':
      return `The file is larger than ${Math.floor(failure.maxBytes / (1024 * 1024))} MB.`;
    case 'unsupported-type':
      return `Unsupported file type: ${failure.mimeType || 'unknown'}. Images only (no SVG).`;
    case 'undecodable':
      return 'The file could not be read as an image.';
    case 'io-error':
      return `Could not store the file: ${failure.detail}`;
  }
}
