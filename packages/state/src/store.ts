import {
  createDocumentFile,
  createProject,
  deserializeDocumentFile,
  type BreakpointId,
  type DeserializeError,
  type IdFactory,
  type NodeId,
  type PageId,
  type Project,
  type ProjectId,
} from '@vpb/core';
import { storageErr, type StorageAdapter, type StorageResult } from '@vpb/storage';
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
import type { History, HistoryEntry } from './history.ts';
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

/**
 * Whether `committed` matches what is durably saved — the Phase F1 checkpoint.
 *
 * `'never-saved'` for a document that has never been written anywhere (fresh
 * off `newDocument`): dirty by definition, independent of whether any edit has
 * happened yet, because nothing on disk represents it at all. Once saved or
 * loaded, `entry` records WHICH `HistoryEntry` (by reference, not value) was at
 * the top of `history.past` at that moment — `null` meaning "history was empty."
 *
 * Reference equality against the CURRENT top of `history.past` is the whole
 * dirty check (`isDirty`, below) and is sound rather than merely convenient:
 * `undo`/`redo` move entries between `past` and `future` without ever
 * recreating them, and `@vpb/state` already guarantees commands are
 * deterministic (nothing mints an id inside `apply`), so the SAME entry
 * reference at the top of `past` can only mean the SAME resulting document. No
 * timestamp, no deep comparison — O(1) on every call.
 */
export type SaveState =
  | { readonly kind: 'never-saved' }
  | { readonly kind: 'saved'; readonly entry: HistoryEntry | null };

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
  readonly saveState: SaveState;
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

  /**
   * Persistence (Phase F1). Not commands, and none of the three below reach
   * `history` as an entry — `save` records nothing new; `loadDocument` and
   * `newDocument` REPLACE `history` outright with a fresh, empty one, which is
   * the "new baseline, not an undoable command back to the previous document"
   * requirement: there is no inverse that could put the old document back,
   * because by the time it would run the old bytes may already be gone.
   */

  /** Serializes `committed`, never `present` — see `SaveState`'s comment. */
  save(): Promise<StorageResult<void>>;
  /** Fully validates before replacing any store state; untouched on failure. */
  loadDocument(id: ProjectId): Promise<StorageResult<void>>;
  newDocument(ids: IdFactory, name?: string): void;
  isDirty(): boolean;
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
  /** Absent means no persistence — `save`/`loadDocument` resolve `io-error`. */
  readonly storage?: StorageAdapter;
}

export function createEditorStore(options: EditorStoreOptions): StoreApi<EditorStore> {
  const { env, storage } = options;
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
      saveState: { kind: 'never-saved' },

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

      async save() {
        if (!storage) {
          return storageErr({ kind: 'io-error', detail: 'No storage adapter configured.' });
        }

        // `committed`, never `present`: a live drag/resize preview lives only in
        // `present` (see `preview`, above), so reading `committed` here means a
        // save can never persist an in-flight gesture — by construction, not by
        // an extra check that could be forgotten or bypassed.
        const { committed, history } = get();
        const file = createDocumentFile(committed.project, new Date(now()).toISOString());
        const outcome = await storage.saveDocument(file);
        if (!outcome.ok) return outcome;

        // The checkpoint re-anchors to whatever is CURRENTLY at the top of
        // history, not to any earlier tail — a save after undoing must mark the
        // undone state clean, not the one the user backed away from.
        set({ saveState: { kind: 'saved', entry: history.past.at(-1) ?? null } });
        return outcome;
      },

      async loadDocument(id) {
        if (!storage) {
          return storageErr({ kind: 'io-error', detail: 'No storage adapter configured.' });
        }

        const loaded = await storage.loadDocument(id);
        if (!loaded.ok) return loaded;

        // Fully validated BEFORE any `set()` call — a bad load must never touch
        // the currently open document, its history, or its checkpoint.
        const result = deserializeDocumentFile(loaded.value);
        if (!result.ok) {
          return storageErr({ kind: 'corrupt', detail: describeDeserializeError(result.error) });
        }

        const nextState = createEditorState(result.document.project);
        set({
          present: nextState,
          committed: nextState,
          // A NEW history baseline, not an undoable command: there is no
          // inverse that could restore the previous document, since by the
          // time one would run its bytes may already be gone.
          history: createHistory(),
          pending: null,
          saveState: { kind: 'saved', entry: null },
        });
        return { ok: true, value: undefined };
      },

      newDocument(ids, name) {
        const project = createProject(name ?? 'Untitled', ids);
        const nextState = createEditorState(project);
        set({
          present: nextState,
          committed: nextState,
          history: createHistory(),
          pending: null,
          // Dirty from creation: nothing on disk represents this document yet,
          // independent of whether the user has made a single edit.
          saveState: { kind: 'never-saved' },
        });
      },

      isDirty() {
        const { history, saveState } = get();
        if (saveState.kind === 'never-saved') return true;
        return (history.past.at(-1) ?? null) !== saveState.entry;
      },
    };
  });
}

function describeDeserializeError(error: DeserializeError): string {
  switch (error.kind) {
    case 'invalid-shape':
      return error.detail;
    case 'unsupported-schema-version':
      return `Unsupported schema version ${error.found}.`;
    case 'validation-failed':
      return error.errors.join('; ');
  }
}
