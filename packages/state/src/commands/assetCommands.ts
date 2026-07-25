import type { Asset, AssetId } from '@vpb/core';
import { getAsset, putAsset, removeAsset, setAssets } from '@vpb/core';

import type { Command } from '../command.ts';
import { refuse, succeed } from '../command.ts';
import type { EditorState } from '../editorState.ts';

/**
 * Commands that edit the asset LIBRARY — the metadata records, never the bytes.
 *
 * Bytes are written to the `StorageAdapter` by the host BEFORE `addAssetCommand`
 * runs, and reclaimed by garbage collection, never by a command. So everything
 * here is pure `@vpb/core` model editing: `apply` reads only its `state` (and
 * takes no `env` beyond the contract's), touches no storage, no resolver, no DOM,
 * and mints no id — the `AssetId` arrives inside the pre-built `Asset`, exactly
 * like `insertNodeCommand` takes a pre-minted node, so redo reproduces the same
 * document.
 *
 * Each command is O(1) to invert: an add undoes to a remove, a remove undoes to
 * an add of the exact record it removed, a rename undoes to the prior name.
 */

function withAssets(state: EditorState, assets: EditorState['project']['assets']): EditorState {
  return { ...state, project: setAssets(state.project, assets) };
}

/**
 * Add a pre-built `Asset` to the library.
 *
 * Refuses a duplicate id rather than overwriting: the inverse is a remove, and
 * an overwrite's remove would delete the record it clobbered instead of restoring
 * it. The host mints the id and decodes the metadata; this command only records.
 */
export function addAssetCommand(asset: Asset): Command {
  return {
    kind: 'addAsset',
    label: `Add ${asset.name}`,
    apply(state) {
      if (getAsset(state.project.assets, asset.id)) {
        return refuse(`An asset with id ${asset.id} already exists.`);
      }
      const next = withAssets(state, putAsset(state.project.assets, asset));
      return succeed(next, removeAssetCommand(asset.id));
    },
  };
}

/**
 * Remove an asset's metadata from the library.
 *
 * Removes even when the asset is still referenced: a dangling reference degrades
 * to a missing asset in the renderer (no `src`), and the panel warns before the
 * user reaches this. It does NOT rewrite references — that would be a large,
 * surprising cascade — and it does NOT touch bytes, which stay until load-time GC
 * so undo can always restore. The inverse re-adds the exact record.
 */
export function removeAssetCommand(id: AssetId): Command {
  return {
    kind: 'removeAsset',
    label: 'Delete asset',
    apply(state) {
      const asset = getAsset(state.project.assets, id);
      if (!asset) return refuse(`No asset ${id} to remove.`);

      const next = withAssets(state, removeAsset(state.project.assets, id));
      return succeed(next, addAssetCommand(asset));
    },
  };
}

/**
 * Rename an asset (its panel label / filename).
 *
 * Coalesces per asset — typing a name is one history entry — and this is sound
 * because it ASSIGNS the name absolutely: a merged run redoes by replaying the
 * LAST command against the pre-first state, which only lands correctly for
 * absolute edits (the same rule `renameNodeCommand` and the style commands
 * follow). The no-op is refused on the VALUE, not on identity, because `putAsset`
 * returns a new library whether or not the name changed.
 */
export function renameAssetCommand(id: AssetId, name: string): Command {
  return {
    kind: 'renameAsset',
    label: 'Rename asset',
    coalesceKey: `renameAsset:${id}`,
    apply(state) {
      const asset = getAsset(state.project.assets, id);
      if (!asset) return refuse(`No asset ${id} to rename.`);
      if (name === asset.name) return refuse('The name is unchanged.');

      const next = withAssets(state, putAsset(state.project.assets, { ...asset, name }));
      return succeed(next, renameAssetCommand(id, asset.name));
    },
  };
}
