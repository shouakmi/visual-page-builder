/**
 * PHASE F3 · Slice D — the asset library commands.
 *
 * add / rename / remove over the asset LIBRARY, each undoable and deterministic.
 * These mutations pin the load-bearing parts: the inverses (an undo that does not
 * restore is silent data loss), the guards (duplicate id, missing asset, no-op
 * rename), and the rename coalesce key. Runs against the `state` project alone;
 * every `find` is a single line.
 */
export default {
  name: 'F3 — asset library commands',
  testCommand: 'pnpm vitest run --project state --silent',
  mutations: [
    {
      // Wrong inverse: undoing an add re-adds instead of removing, so the added
      // asset can never be undone away.
      name: 'addAsset inverts to another add instead of a remove',
      file: 'packages/state/src/commands/assetCommands.ts',
      find: '      return succeed(next, removeAssetCommand(asset.id));',
      replace: '      return succeed(next, addAssetCommand(asset));',
    },
    {
      // The duplicate-id guard is disabled, so a second add clobbers the record
      // and its remove-inverse would then delete the wrong bytes' metadata.
      name: 'addAsset drops the duplicate-id guard',
      file: 'packages/state/src/commands/assetCommands.ts',
      find: '      if (getAsset(state.project.assets, asset.id)) {',
      replace: '      if (false) {',
    },
    {
      // Wrong inverse: undoing a remove removes again instead of restoring the
      // record — the delete becomes unrecoverable.
      name: 'removeAsset inverts to another remove instead of restoring the record',
      file: 'packages/state/src/commands/assetCommands.ts',
      find: '      return succeed(next, addAssetCommand(asset));',
      replace: '      return succeed(next, removeAssetCommand(id));',
    },
    {
      // The existence guard is dropped; removing a missing asset then reports a
      // spurious success (setAssets returns a new project even when nothing left).
      name: 'removeAsset drops the missing-asset guard',
      file: 'packages/state/src/commands/assetCommands.ts',
      find: '      if (!asset) return refuse(`No asset ${id} to remove.`);',
      replace: '',
    },
    {
      // The no-op guard is dropped, so renaming to the same name takes an invisible
      // history entry.
      name: 'renameAsset drops the no-op guard',
      file: 'packages/state/src/commands/assetCommands.ts',
      find: "      if (name === asset.name) return refuse('The name is unchanged.');",
      replace: '',
    },
    {
      // No coalesce key: typing a name records one entry per keystroke instead of
      // one per rename.
      name: 'renameAsset loses its coalesce key',
      file: 'packages/state/src/commands/assetCommands.ts',
      find: '    coalesceKey: `renameAsset:${id}`,',
      replace: '',
    },
    {
      // The inverse captures the NEW name instead of the old, so undo is a no-op
      // (and is refused), never restoring the previous name.
      name: 'renameAsset inverts with the new name instead of the old',
      file: 'packages/state/src/commands/assetCommands.ts',
      find: '      return succeed(next, renameAssetCommand(id, asset.name));',
      replace: '      return succeed(next, renameAssetCommand(id, name));',
    },
  ],
};
