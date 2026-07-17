import type { BreakpointId, NodeId, PageId, Project } from '@vpb/core';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { Command, CommandOutcome, EditorEnvironment } from './command.ts';
import { applyCommand } from './command.ts';
import type { EditorState } from './editorState.ts';
import {
  createEditorState,
  select as selectNodes,
  setActiveBreakpoint,
  setActivePage,
  clearSelection as clearNodeSelection,
  extendSelection as extendNodeSelection,
} from './editorState.ts';
import type { History } from './history.ts';
import { canRedo, canUndo, createHistory, entryFor, record, redo, undo } from './history.ts';

/**
 * THE EDITOR STORE.
 *
 * `zustand/vanilla`, not `zustand` — the difference is the whole point. The
 * vanilla entry has no React in it, so this file imports no framework and the
 * package's Vitest project runs in **node**. AUDIT §7.8: the prototype's state
 * "is a React hook. `useEditor` is a 120-line god-hook owning tree ops, assets,
 * history, and persistence. None of it is testable headlessly or reusable in the
 * Electron main process." Phase D binds React to this with `useStore`; nothing
 * here knows that happened. AUDIT §244 also notes Zustand was "chosen in Phase 1,
 * never used" — this is where it finally is.
 */

export interface EditorStoreState {
  /**
   * What the editor renders. During a preview this is the previewed state; the
   * rest of the time it is `committed`.
   */
  readonly present: EditorState;
  /** The last state that reached history. A preview never touches this. */
  readonly committed: EditorState;
  readonly history: History;
  /** The command being previewed, if any. */
  readonly pending: Command | null;
}

export interface EditorStoreActions {
  /** Run a command and record it. Returns the outcome so a UI can show a refusal. */
  execute(command: Command): CommandOutcome;
  /**
   * Show a command's effect WITHOUT recording it — a drag in flight.
   *
   * Always applied to `committed`, never to the previous preview, so a drag that
   * emits sixty absolute values is sixty independent applications of one edit
   * rather than sixty stacked ones.
   */
  preview(command: Command): CommandOutcome;
  /** Turn the previewed command into exactly one history entry. */
  commitPreview(): CommandOutcome | undefined;
  /** Throw the preview away — Escape during a drag. */
  cancelPreview(): void;

  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;

  /* Context. None of these are commands and none reach history — see EditorContext. */
  select(ids: readonly NodeId[]): void;
  extendSelection(ids: readonly NodeId[]): void;
  clearSelection(): void;
  setActivePage(id: PageId): void;
  setActiveBreakpoint(id: BreakpointId): void;
}

export type EditorStore = EditorStoreState & EditorStoreActions;

export interface EditorStoreOptions {
  readonly project: Project;
  readonly env: EditorEnvironment;
  /**
   * Injected so the coalescing window is testable without waiting.
   *
   * The same seam as `ThemeStorage` in @vpb/ui: a test drives time instead of
   * sleeping, and nothing here reaches for a global.
   */
  readonly now?: () => number;
  readonly history?: History;
}

export function createEditorStore(options: EditorStoreOptions): StoreApi<EditorStore> {
  const { env } = options;
  const now = options.now ?? (() => Date.now());
  const initial = createEditorState(options.project);

  return createStore<EditorStore>((set, get) => {
    /** Context edits apply to both layers: they are not part of the edit history. */
    const withBoth = (update: (state: EditorState) => EditorState) => {
      const { present, committed, pending } = get();
      const nextCommitted = update(committed);
      set({
        committed: nextCommitted,
        present: pending === null ? nextCommitted : update(present),
      });
    };

    return {
      present: initial,
      committed: initial,
      history: options.history ?? createHistory(),
      pending: null,

      execute(command) {
        // A pending preview is superseded rather than merged: the caller asked
        // for a different edit, and committing a half-finished drag on its way
        // out would record something the user never released the mouse on.
        const { committed } = get();
        const outcome = applyCommand(committed, command, env);
        if (!outcome.ok) return outcome;

        const entry = entryFor(command, committed, outcome.state, outcome.inverse, now());
        set({
          present: outcome.state,
          committed: outcome.state,
          pending: null,
          history: record(get().history, entry),
        });
        return outcome;
      },

      preview(command) {
        const { committed } = get();
        const outcome = applyCommand(committed, command, env);
        if (!outcome.ok) return outcome;

        set({ present: outcome.state, pending: command });
        return outcome;
      },

      commitPreview() {
        const { pending } = get();
        if (!pending) return undefined;
        // Re-applied to `committed` rather than trusting the preview's state, so
        // the recorded inverse is computed against the state history will
        // actually rewind to.
        return get().execute(pending);
      },

      cancelPreview() {
        const { committed, pending } = get();
        if (!pending) return;
        set({ present: committed, pending: null });
      },

      undo() {
        // A preview is not an edit; drop it rather than undo through it.
        const { committed, history } = get();
        const step = undo(committed, history, env);
        if (!step) return false;

        set({ present: step.state, committed: step.state, history: step.history, pending: null });
        return true;
      },

      redo() {
        const { committed, history } = get();
        const step = redo(committed, history, env);
        if (!step) return false;

        set({ present: step.state, committed: step.state, history: step.history, pending: null });
        return true;
      },

      canUndo: () => canUndo(get().history),
      canRedo: () => canRedo(get().history),

      select: (ids) => withBoth((state) => selectNodes(state, ids)),
      extendSelection: (ids) => withBoth((state) => extendNodeSelection(state, ids)),
      clearSelection: () => withBoth((state) => clearNodeSelection(state)),
      setActivePage: (id) => withBoth((state) => setActivePage(state, id)),
      setActiveBreakpoint: (id) => withBoth((state) => setActiveBreakpoint(state, id)),
    };
  });
}
