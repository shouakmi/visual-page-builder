import type { AssetId, DocumentFile, ProjectId } from '@vpb/core';

/**
 * THE STORAGE ADAPTER CONTRACT.
 *
 * `@vpb/storage` depends on `@vpb/core` (for `DocumentFile` and the branded ids)
 * and on nothing else — not `@vpb/state`, not React, not a DOM, not IndexedDB or
 * a filesystem module. That dependency direction (`core <- storage <- state <-
 * apps/web`) is what lets the store orchestrate persistence without either
 * package needing to know a concrete adapter exists.
 *
 * BYTES IN, BYTES OUT — NO SCHEMA KNOWLEDGE. `loadDocument` returns `unknown`,
 * not `DocumentFile`, deliberately: an adapter round-trips whatever JSON-safe
 * value it was given faithfully, but it must not parse or validate what that
 * value MEANS. The untrusted boundary is enforced by this return type — every
 * caller is forced through `@vpb/core`'s `deserializeDocumentFile` before
 * anything here is trusted as a real document. `saveDocument` accepts a typed
 * `DocumentFile` instead, because the CALLER (the store) produced it via
 * `serializeProject` from its own already-trusted, in-memory `Project`.
 *
 * CANNOT THROW PAST ITS BOUNDARY. Every method returns a `Promise` that always
 * resolves to a `StorageResult` — the same "cannot throw" contract `@vpb/ui`'s
 * `ThemeStorage` already enforces synchronously, extended to async because
 * IndexedDB and SQLite fail in more ways than `localStorage` does (quota,
 * blocked upgrades, corruption).
 *
 * NOT THIS ADAPTER'S JOB, ON PURPOSE:
 *  - Debounce/autosave policy — that is the store/app integration layer's, so
 *    an adapter never decides WHEN to save, only HOW.
 *  - Dirty-state tracking — the store's `saveState` checkpoint, not this.
 *  - Cross-document transactions — one atomic transaction per `saveDocument`
 *    call is the whole guarantee; nothing here spans two documents.
 *  - Multi-writer conflict resolution — single-writer per document is assumed;
 *    real conflict resolution is Phase L's CRDT job.
 */

export type StorageError =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'quota-exceeded' }
  | { readonly kind: 'io-error'; readonly detail: string }
  | { readonly kind: 'corrupt'; readonly detail: string };

export type StorageResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: StorageError };

export function storageOk<T>(value: T): StorageResult<T> {
  return { ok: true, value };
}

export function storageErr<T = never>(error: StorageError): StorageResult<T> {
  return { ok: false, error };
}

/** What a documents list shows — not the whole document. */
export interface DocumentSummary {
  readonly id: ProjectId;
  readonly name: string;
  readonly updatedAt: string;
}

export interface StorageAdapter {
  listDocuments(): Promise<StorageResult<readonly DocumentSummary[]>>;
  /** Untrusted on purpose — see the file comment. */
  loadDocument(id: ProjectId): Promise<StorageResult<unknown>>;
  saveDocument(file: DocumentFile): Promise<StorageResult<void>>;
  deleteDocument(id: ProjectId): Promise<StorageResult<void>>;

  /** Contract defined in F1; exercised for real (asset commands, uploads) in F3. */
  saveAssetBytes(id: AssetId, bytes: Blob, mimeType: string): Promise<StorageResult<void>>;
  loadAssetBytes(id: AssetId): Promise<StorageResult<Blob>>;
  deleteAssetBytes(id: AssetId): Promise<StorageResult<void>>;

  /**
   * Every asset id that currently has bytes stored — the enumeration byte
   * garbage collection needs (F3).
   *
   * Byte GC finds stored bytes with no live metadata by subtracting the loaded
   * project's asset ids from THIS set; there is no other way to discover an
   * orphaned blob, since bytes outlive the document that referenced them. It
   * returns storage *keys*, not trusted assets — like `loadDocument`, an adapter
   * reports what it holds and never vouches for its meaning.
   */
  listAssetIds(): Promise<StorageResult<readonly AssetId[]>>;
}
