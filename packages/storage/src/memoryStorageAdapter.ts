import type { AssetId, DocumentFile, ProjectId } from '@vpb/core';

import type { DocumentSummary, StorageAdapter } from './storageAdapter.ts';
import { storageErr, storageOk } from './storageAdapter.ts';

interface StoredAsset {
  readonly bytes: Blob;
  readonly mimeType: string;
}

/**
 * In-process storage adapter. Every method resolves, never throws.
 *
 * Two roles: F1's store tests use it as the one real `StorageAdapter` there is
 * before a browser or a desktop host exists, and the desktop-shaped contract
 * run (F4) exercises the SAME contract suite against it, since it assumes
 * nothing about any one platform's quirks.
 *
 * `structuredClone` on every read and write, deliberately — a real adapter
 * (IndexedDB explicitly uses the structured clone algorithm; a JSON-backed
 * SQLite column round-trips through `JSON.stringify`/`.parse`) never hands back
 * the SAME object a caller gave it. Skipping that here would let a test pass
 * only because two calls happened to share a reference in memory, which is
 * exactly the kind of pass the mutation-testing philosophy this project uses
 * distrusts.
 */
export function createMemoryStorageAdapter(): StorageAdapter {
  const documents = new Map<ProjectId, DocumentFile>();
  const assets = new Map<AssetId, StoredAsset>();

  return {
    async listDocuments() {
      const summaries: DocumentSummary[] = [...documents.values()].map((file) => ({
        id: file.id,
        name: file.project.name,
        updatedAt: file.updatedAt,
      }));
      return storageOk(summaries);
    },

    async loadDocument(id) {
      const file = documents.get(id);
      return file ? storageOk(structuredClone(file)) : storageErr({ kind: 'not-found' });
    },

    async saveDocument(file) {
      documents.set(file.id, structuredClone(file));
      return storageOk(undefined);
    },

    async deleteDocument(id) {
      documents.delete(id);
      return storageOk(undefined);
    },

    async saveAssetBytes(id, bytes, mimeType) {
      assets.set(id, { bytes: structuredClone(bytes), mimeType });
      return storageOk(undefined);
    },

    async loadAssetBytes(id) {
      const asset = assets.get(id);
      return asset ? storageOk(structuredClone(asset.bytes)) : storageErr({ kind: 'not-found' });
    },

    async deleteAssetBytes(id) {
      assets.delete(id);
      return storageOk(undefined);
    },

    async listAssetIds() {
      return storageOk([...assets.keys()]);
    },
  };
}
