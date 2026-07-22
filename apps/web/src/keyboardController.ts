import { removeNodesCommand, reorderNodesCommand, type EditorStore } from '@vpb/state';
import type { StoreApi } from 'zustand/vanilla';

/**
 * THE KEYBOARD CONTROLLER — editor shortcuts wired to the store.
 *
 * The third sibling of `dragController` and `resizeController`, and the same
 * testable seam: it takes a `KeyboardEvent` and turns it into store calls. It binds
 * nothing itself, so the whole shortcut table is unit-testable against a REAL store
 * with no React and no listener plumbing; `Canvas` only attaches the listener.
 *
 * Two guards that are easy to leave out and painful to ship without:
 *
 * - **Never hijack typing.** A shortcut layer on `window` sees every keystroke,
 *   including those meant for an input. Backspace in a text field must delete a
 *   character, not the user's section. The check uses `closest`, not
 *   `instanceof HTMLInputElement`, for the same realm reason E1 documented: nodes
 *   created inside the same-origin canvas frame fail a parent-realm `instanceof`.
 * - **Stay out of a gesture.** While a drag or resize is previewing, `pending` is
 *   non-null and that gesture owns the keyboard — its own Escape reverts the
 *   preview. If this layer also answered Escape it would clear the selection out
 *   from under a cancel, and Delete mid-drag would edit a document that is halfway
 *   through a move.
 *
 * Arrow keys REORDER among siblings (Left/Up earlier, Right/Down later) rather than
 * nudging by pixels: flow layout has no `left`/`top` to move, so pixel nudging would
 * mean inventing a positioning model. That waits for absolute positioning.
 */

export interface KeyboardController {
  /** Handle one key press. Ignores anything that is not a shortcut. */
  handle(event: KeyboardEvent): void;
}

const TEXT_ENTRY = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

function isTextEntry(target: EventTarget | null): boolean {
  const element = target as Element | null;
  if (!element || typeof element.closest !== 'function') return false;
  return element.closest(TEXT_ENTRY) !== null;
}

export function createKeyboardController(store: StoreApi<EditorStore>): KeyboardController {
  return {
    handle(event) {
      if (isTextEntry(event.target)) return;

      const state = store.getState();
      // A previewing gesture owns the keyboard until it commits or cancels.
      if (state.pending !== null) return;

      const modified = event.ctrlKey || event.metaKey;
      const key = event.key;

      if (modified) {
        const lower = key.toLowerCase();
        if (lower === 'z' && !event.shiftKey) {
          state.undo();
          event.preventDefault();
        } else if ((lower === 'z' && event.shiftKey) || lower === 'y') {
          state.redo();
          event.preventDefault();
        }
        // Every other modified key belongs to the browser or a future shortcut.
        return;
      }

      const selection = state.present.context.selection;

      switch (key) {
        case 'Delete':
        case 'Backspace': {
          if (selection.length === 0) return;
          state.execute(removeNodesCommand(selection));
          // Backspace navigates back in some browsers; never let it.
          event.preventDefault();
          return;
        }

        case 'Escape': {
          state.clearSelection();
          return;
        }

        case 'ArrowLeft':
        case 'ArrowUp': {
          if (selection.length === 0) return;
          state.execute(reorderNodesCommand(selection, -1));
          event.preventDefault();
          return;
        }

        case 'ArrowRight':
        case 'ArrowDown': {
          if (selection.length === 0) return;
          state.execute(reorderNodesCommand(selection, 1));
          event.preventDefault();
          return;
        }

        default:
          return;
      }
    },
  };
}
