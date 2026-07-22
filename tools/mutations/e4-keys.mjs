/**
 * PHASE E4 — the keyboard controller.
 *
 * The shortcut table wired to the store: Delete, arrow-reorder, Escape, undo/redo.
 * Its bugs are the ones that make an editor feel hostile — a Delete that eats the
 * user's text while they type, an undo bound to redo, a shortcut that fires in the
 * middle of a drag. Runs against the `web` project alone; every `find` is a single
 * line.
 */
export default {
  name: 'E4 — keyboard shortcuts',
  testCommand: 'pnpm vitest run --project web --silent',
  mutations: [
    {
      // The whole feature, silently absent.
      name: 'Delete no longer deletes',
      file: 'apps/web/src/keyboardController.ts',
      find: '          state.execute(removeNodesCommand(selection));',
      replace: '          void 0;',
    },
    {
      // Deletes only the primary selection — multi-select silently half-works, the
      // exact thing E4 exists to fix.
      name: 'Delete removes only the first selected node',
      file: 'apps/web/src/keyboardController.ts',
      find: '          state.execute(removeNodesCommand(selection));',
      replace: '          state.execute(removeNodesCommand(selection.slice(0, 1)));',
    },
    {
      // Left/Up move the node later instead of earlier.
      name: 'the arrow reorder direction is inverted',
      file: 'apps/web/src/keyboardController.ts',
      find: '          state.execute(reorderNodesCommand(selection, -1));',
      replace: '          state.execute(reorderNodesCommand(selection, 1));',
    },
    {
      // Ctrl+Z redoing is worse than Ctrl+Z doing nothing: it destroys the edit the
      // user was trying to get back to.
      name: 'Ctrl+Z is wired to redo',
      file: 'apps/web/src/keyboardController.ts',
      find: '          state.undo();',
      replace: '          state.redo();',
    },
    {
      // The shortcut layer sits on `window`, so without this guard Backspace in a
      // text field deletes the user's SECTION instead of a character.
      name: 'shortcuts fire while the user is typing in a field',
      file: 'apps/web/src/keyboardController.ts',
      find: '      if (isTextEntry(event.target)) return;',
      replace: '      if (false) return;',
    },
    {
      // Escape must clear the selection.
      name: 'Escape no longer clears the selection',
      file: 'apps/web/src/keyboardController.ts',
      find: '          state.clearSelection();',
      replace: '          void 0;',
    },
    {
      // A previewing drag/resize owns the keyboard. Answer Escape here as well and
      // the selection is cleared out from under the gesture's own cancel.
      name: 'the in-flight gesture guard is removed',
      file: 'apps/web/src/keyboardController.ts',
      find: '      if (state.pending !== null) return;',
      replace: '      if (false) return;',
    },
  ],
};
