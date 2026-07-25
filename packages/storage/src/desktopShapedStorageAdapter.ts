import type { AssetId, DocumentFile, ProjectId } from '@vpb/core';

import type { DocumentSummary, StorageAdapter, StorageResult } from './storageAdapter.ts';
import { storageErr, storageOk } from './storageAdapter.ts';

/**
 * THE DESKTOP-SHAPED `StorageAdapter` FAKE (Phase F4).
 *
 * WHY A THIRD ADAPTER EXISTS. The memory and IndexedDB adapters both round-trip
 * through the STRUCTURED CLONE algorithm — the memory one calls
 * `structuredClone` explicitly, IndexedDB uses it natively. So while
 * `runStorageAdapterContractTests` proves those two agree, it has only ever
 * proven agreement WITHIN one serialization family. Phase J's real SQLite
 * adapter belongs to a different one: a document is a JSON TEXT column and asset
 * bytes are a BINARY column. This adapter is that second family, so the shared
 * contract is finally proven across both — and anything in `DocumentFile` that
 * survives a structured clone but not `JSON.stringify`/`JSON.parse` (a stray
 * `Map`, a `Date`, an explicitly-`undefined` field, a cycle) fails HERE, in a
 * node test, rather than in Phase J against a user's real project.
 *
 * WHAT IT IS NOT. It is not SQLite, and it does not prove any claim about
 * SQLite's behaviour — no driver, no file, no SQL. Per Phase F's scope it
 * introduces no Node-specific database code at all: it is pure TypeScript that
 * runs in the same node Vitest project as every other adapter here. What it
 * proves is SERIALIZATION-MODEL INDEPENDENCE of the contract. Phase J still runs
 * the same suite against the real adapter.
 *
 * ROWS, NOT AN OBJECT GRAPH. `listDocuments` reads the `id`/`name`/`updatedAt`
 * COLUMNS persisted at write time — the shape of `SELECT id, name, updated_at
 * FROM documents` — rather than re-parsing each payload and walking into
 * `project.name`. A real adapter cannot afford to parse every document to list
 * them, so the fake must not either, or the contract would be proven against an
 * implementation Phase J cannot copy.
 *
 * CANNOT THROW PAST ITS BOUNDARY, exactly as `storageAdapter.ts` requires. Two
 * failure sources are mapped rather than propagated: a driver-style error
 * carrying a SQLite result CODE (the desktop analogue of F2's mapping by
 * DOMException NAME), and a payload that will not serialize or will not parse.
 */

/** One row of the `documents` table. `payload` is the JSON text column. */
export interface DesktopDocumentRow {
  readonly id: ProjectId;
  readonly name: string;
  readonly updatedAt: string;
  readonly payload: string;
}

/**
 * One row of the `assets` table. `bytes` is the binary column.
 *
 * `Uint8Array<ArrayBuffer>`, not a bare `Uint8Array`: the latter widens to
 * `ArrayBufferLike`, which admits a `SharedArrayBuffer` and is therefore not a
 * `BlobPart`. A row read out of a database is always backed by its own
 * non-shared buffer, so the narrower type is the true one.
 */
export interface DesktopAssetRow {
  readonly id: AssetId;
  readonly mimeType: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

/**
 * The two tables, injected.
 *
 * The same seam discipline as F2's `IDBFactory`: the storage primitive is a
 * parameter, so a test provokes a real failure by passing a `Map` subclass whose
 * `get`/`set` throws the way a driver does — no mocking framework, no global
 * stub. Injecting them also lets a test write a deliberately corrupt row
 * directly, which is the only honest way to reach the "stored text will not
 * parse" branch: no public write path can produce it.
 */
export interface DesktopTables {
  readonly documents: Map<ProjectId, DesktopDocumentRow>;
  readonly assets: Map<AssetId, DesktopAssetRow>;
}

export interface DesktopShapedStorageAdapterOptions {
  /** Defaults to fresh in-process tables — one instance owns its own storage. */
  readonly tables?: DesktopTables;
}

export function createDesktopShapedStorageAdapter(
  options: DesktopShapedStorageAdapterOptions = {},
): StorageAdapter {
  const tables: DesktopTables = options.tables ?? {
    documents: new Map<ProjectId, DesktopDocumentRow>(),
    assets: new Map<AssetId, DesktopAssetRow>(),
  };

  return {
    async listDocuments() {
      try {
        const summaries: DocumentSummary[] = [...tables.documents.values()].map((row) => ({
          id: row.id,
          name: row.name,
          updatedAt: row.updatedAt,
        }));
        return storageOk(summaries);
      } catch (error) {
        return mapError(error);
      }
    },

    async loadDocument(id) {
      try {
        const row = tables.documents.get(id);
        if (!row) return storageErr({ kind: 'not-found' });
        return parsePayload(row.payload);
      } catch (error) {
        return mapError(error);
      }
    },

    async saveDocument(file) {
      // Serialized BEFORE the row is written, so a payload that cannot be
      // persisted leaves the table untouched rather than half-updated.
      const payload = serializePayload(file);
      if (!payload.ok) return payload;

      try {
        tables.documents.set(file.id, {
          id: file.id,
          // Denormalised at write time — this is the column the list reads.
          name: file.project.name,
          updatedAt: file.updatedAt,
          payload: payload.value,
        });
        return storageOk(undefined);
      } catch (error) {
        return mapError(error);
      }
    },

    async deleteDocument(id) {
      try {
        tables.documents.delete(id);
        return storageOk(undefined);
      } catch (error) {
        return mapError(error);
      }
    },

    async saveAssetBytes(id, bytes, mimeType) {
      try {
        // `Blob` -> `Uint8Array` is the binary-column boundary: what a driver
        // binds to a BLOB parameter. `arrayBuffer()` already yields a fresh
        // buffer, so the stored row shares nothing with the caller's blob.
        const buffer = new Uint8Array(await bytes.arrayBuffer());
        tables.assets.set(id, { id, mimeType, bytes: buffer });
        return storageOk(undefined);
      } catch (error) {
        return mapError(error);
      }
    },

    async loadAssetBytes(id) {
      try {
        const row = tables.assets.get(id);
        if (!row) return storageErr({ kind: 'not-found' });
        // The `Blob` is RECONSTRUCTED from the binary column plus the stored
        // mime-type column. A binary column carries no type of its own, so an
        // adapter that forgot to persist or re-apply `mimeType` would hand back
        // a type-less blob — which is why the contract asserts on `Blob.type`.
        return storageOk(new Blob([row.bytes], { type: row.mimeType }));
      } catch (error) {
        return mapError(error);
      }
    },

    async deleteAssetBytes(id) {
      try {
        tables.assets.delete(id);
        return storageOk(undefined);
      } catch (error) {
        return mapError(error);
      }
    },

    async listAssetIds() {
      try {
        return storageOk([...tables.assets.keys()]);
      } catch (error) {
        return mapError(error);
      }
    },
  };
}

/**
 * The JSON text column, written.
 *
 * A failure here is `corrupt`, not `io-error`: nothing is wrong with the store,
 * the VALUE cannot be represented. That is the same judgement F2's adapter makes
 * when the structured clone algorithm raises `DataCloneError`.
 */
function serializePayload(file: DocumentFile): StorageResult<string> {
  try {
    return storageOk(JSON.stringify(file));
  } catch (error) {
    return storageErr({ kind: 'corrupt', detail: describe(error) });
  }
}

/**
 * The JSON text column, read back — `unknown`, never a `DocumentFile`.
 *
 * Parsing produces a plain JSON value and this adapter does not vouch for its
 * meaning; `@vpb/core`'s `deserializeDocumentFile` is what decides whether it is
 * a document. Text that will not parse at all is `corrupt`: the row exists, so
 * `not-found` would be a lie, and the caller needs to tell "this document is
 * damaged" from "this document is missing".
 */
function parsePayload(payload: string): StorageResult<unknown> {
  try {
    return storageOk(JSON.parse(payload) as unknown);
  } catch (error) {
    return storageErr({ kind: 'corrupt', detail: describe(error) });
  }
}

/** A driver-style SQLite result code, without relying on `instanceof`. */
function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code: unknown };
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/**
 * Driver error -> `StorageError`, by result CODE.
 *
 * The desktop analogue of F2's mapping by DOMException name: a SQLite driver
 * reports `SQLITE_FULL` for a full disk or database, and `SQLITE_CORRUPT` /
 * `SQLITE_NOTADB` for a damaged file. Everything else is an I/O failure, which
 * is the honest default — an unrecognised code must never be silently
 * classified as something the host would act on differently.
 */
function mapError(error: unknown): StorageResult<never> {
  switch (errorCode(error)) {
    case 'SQLITE_FULL':
      return storageErr({ kind: 'quota-exceeded' });
    case 'SQLITE_CORRUPT':
    case 'SQLITE_NOTADB':
      return storageErr({ kind: 'corrupt', detail: describe(error) });
    default:
      return storageErr({ kind: 'io-error', detail: describe(error) });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
