/**
 * PHASE E2 — the drag controller (store integration).
 *
 * `createDragController` turns the machine's intents into store calls: a drag
 * PREVIEWS a `moveNodeCommand` and COMMITS it on release, cancels revert. Every
 * mutation here swaps one store call for another — commit for cancel, preview for
 * nothing — and each is a way the drag looks like it works while the document, or
 * the undo stack, quietly disagrees. Tested against a real store, no DOM.
 */
export default {
  name: 'E2 — drag controller',
  testCommand: 'pnpm vitest run --project web --silent',
  mutations: [
    {
      // The drag never previews, so nothing moves on screen while you drag.
      name: 'the drag never previews the move',
      file: 'apps/web/src/dragController.ts',
      find: '        store\n          .getState()\n          .preview(moveNodeCommand(intent.nodeId, intent.drop.parentId, intent.drop.index));',
      replace: '        break;',
    },
    {
      // Release cancels instead of committing: the move you just made evaporates
      // the instant you let go.
      name: 'release cancels the move instead of committing it',
      file: 'apps/web/src/dragController.ts',
      find: "      case 'commit':\n        store.getState().commitPreview();\n        break;",
      replace: "      case 'commit':\n        store.getState().cancelPreview();\n        break;",
    },
    {
      // Cancel commits instead of reverting: Escape and an invalid hover both leave
      // the half-finished move in history.
      name: 'cancel commits the move instead of reverting it',
      file: 'apps/web/src/dragController.ts',
      find: "      case 'clearPreview':\n      case 'cancel':\n        store.getState().cancelPreview();\n        break;",
      replace:
        "      case 'clearPreview':\n      case 'cancel':\n        store.getState().commitPreview();\n        break;",
    },
    {
      // The phase flip drives pointer capture and the iframe shield. Never
      // reporting it means the shield never rises and the drag stalls over the frame.
      name: 'the drag start/end phase change is never announced',
      file: 'apps/web/src/dragController.ts',
      find: '    if (nowDragging !== wasDragging) options.onDraggingChange?.(nowDragging);',
      replace: '    if (false) options.onDraggingChange?.(nowDragging);',
    },
  ],
};
