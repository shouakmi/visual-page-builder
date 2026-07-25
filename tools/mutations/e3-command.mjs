/**
 * PHASE E3 — the one-entry sizing command (`setStylePropertiesCommand`).
 *
 * A corner resize sets width AND height as ONE history entry; this set proves the
 * suite catches the two ways that guarantee breaks. Runs against the `state` project
 * alone. Both `find`s are single-line, so LF/CRLF endings do not matter.
 */
export default {
  name: 'E3 — resize one-entry command',
  testCommand: 'pnpm vitest run --project state --silent',
  mutations: [
    {
      // The properties are what make one gesture's key distinct from another's. Drop
      // them and a width-only resize coalesces into a preceding width+height one.
      name: 'the coalesce key forgets which properties are edited',
      file: 'packages/state/src/commands/styleCommands.ts',
      find: '  return `setStyleProperties:${scopeKey(scope)}:${targetKey(target)}:${properties}`;',
      replace: '  return `setStyleProperties:${scopeKey(scope)}:${targetKey(target)}`;',
    },
    {
      // Undoing a resize must UNSET a property it newly added, not leave it. Leave it
      // and undoing a corner resize on an auto-sized box strands one axis pinned.
      // `? unsetProperty(...)` is unique to the restore inverse (the singular unset
      // command writes `styles: unsetProperty(...)`, no leading `?`).
      name: 'undo does not unset a newly-added property',
      file: 'packages/state/src/commands/styleCommands.ts',
      find: '            ? unsetProperty(styles, scope, target, property)',
      replace: '            ? styles',
    },
  ],
};
