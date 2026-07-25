import { allAssets, usedAssets, type AssetId, type IdFactory } from '@vpb/core';
import { removeAssetCommand, renameAssetCommand, type EditorStore } from '@vpb/state';
import type { StorageAdapter } from '@vpb/storage';
import { Button } from '@vpb/ui';
import { useEffect, useState } from 'react';
import { useStore, type StoreApi } from 'zustand';

import {
  decodeImageSize,
  describeUploadFailure,
  performUpload,
  sortAssetsByNewest,
} from './assetUpload.ts';

/**
 * The minimal Asset panel (Phase F3, Slice E).
 *
 * Single source of truth: everything shown is DERIVED from the store on each
 * render (`allAssets`, `usedAssets`, plus a `listAssetIds` probe for missing
 * bytes), so rapid consecutive edits can never desynchronise the panel from the
 * document — there is no mirrored asset state to drift.
 *
 * The panel owns no bytes and mints no ids at edit time: uploads go through the
 * host `performUpload` (validate → store bytes → command), and rename/delete are
 * the undoable metadata commands.
 */

export interface AssetPanelProps {
  readonly store: StoreApi<EditorStore>;
  readonly adapter: StorageAdapter;
  readonly ids: IdFactory;
  readonly now?: () => number;
  /** Injected so tests drive validation without a real image decoder. */
  readonly decode?: (blob: Blob) => Promise<{ width: number; height: number } | null>;
}

export function AssetPanel({ store, adapter, ids, now, decode }: AssetPanelProps) {
  const project = useStore(store, (state) => state.present.project);
  const assets = sortAssetsByNewest(allAssets(project.assets));
  const usedIds = new Set<AssetId>(usedAssets(project));

  const [error, setError] = useState<string | null>(null);
  const [storedIds, setStoredIds] = useState<ReadonlySet<AssetId> | null>(null);
  const [renaming, setRenaming] = useState<AssetId | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState<AssetId | null>(null);

  // Probe which assets actually have bytes, re-running whenever the asset set
  // changes. An asset in the library but not here is "missing bytes".
  const idKey = assets.map((asset) => asset.id).join(',');
  useEffect(() => {
    let cancelled = false;
    void adapter.listAssetIds().then((result) => {
      if (!cancelled) setStoredIds(result.ok ? new Set(result.value) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, idKey]);

  const decoder = decode ?? decodeImageSize;

  async function onFiles(files: FileList | null): Promise<void> {
    if (!files) return;
    setError(null);
    for (const file of Array.from(files)) {
      const outcome = await performUpload(file, {
        store,
        adapter,
        ids,
        decode: decoder,
        ...(now ? { now } : {}),
      });
      if (!outcome.ok) setError(describeUploadFailure(outcome.failure));
    }
  }

  function commitRename(id: AssetId): void {
    store.getState().execute(renameAssetCommand(id, draftName));
    setRenaming(null);
  }

  function confirmDelete(id: AssetId): void {
    store.getState().execute(removeAssetCommand(id));
    setConfirmingDelete(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="inline-flex">
        <span className="sr-only">Upload image</span>
        <input
          type="file"
          aria-label="Upload image"
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
          multiple
          onChange={(event) => {
            const { files } = event.target;
            event.target.value = ''; // allow re-selecting the same file
            void onFiles(files);
          }}
        />
      </label>

      {error !== null && (
        <p role="alert" className="text-xs text-foreground">
          {error}
        </p>
      )}

      {assets.length === 0 ? (
        <p className="text-xs text-foreground-muted">No assets yet.</p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Assets">
          {assets.map((asset) => {
            const unused = !usedIds.has(asset.id);
            const missing = storedIds !== null && !storedIds.has(asset.id);
            return (
              <li key={asset.id} className="flex flex-col gap-0.5 text-xs">
                <div className="flex items-center gap-1">
                  {renaming === asset.id ? (
                    <input
                      aria-label={`Rename ${asset.name}`}
                      value={draftName}
                      autoFocus
                      onChange={(event) => setDraftName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename(asset.id);
                        if (event.key === 'Escape') setRenaming(null);
                      }}
                      onBlur={() => setRenaming(null)}
                    />
                  ) : (
                    <span className="truncate text-foreground" title={asset.name}>
                      {asset.name}
                    </span>
                  )}
                  {missing && <span className="text-foreground-subtle">missing</span>}
                  {!missing && unused && <span className="text-foreground-subtle">unused</span>}
                  <span className="ml-auto flex gap-0.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Rename ${asset.name}`}
                      onClick={() => {
                        setDraftName(asset.name);
                        setRenaming(asset.id);
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${asset.name}`}
                      onClick={() => setConfirmingDelete(asset.id)}
                    >
                      Delete
                    </Button>
                  </span>
                </div>

                {confirmingDelete === asset.id && (
                  <div
                    role="alertdialog"
                    aria-label={`Delete ${asset.name}?`}
                    className="flex items-center gap-1"
                  >
                    <span className="text-foreground-muted">
                      Delete {asset.name}?{usedIds.has(asset.id) ? ' It is still in use.' : ''}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Confirm delete ${asset.name}`}
                      onClick={() => confirmDelete(asset.id)}
                    >
                      Confirm
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Cancel delete ${asset.name}`}
                      onClick={() => setConfirmingDelete(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
