/* Editor state — the document plus where the user is in it. */
export {
  createEditorState,
  activePage,
  isSelected,
  primarySelection,
  withContext,
  select,
  clearSelection,
  extendSelection,
  deselect,
  setActivePage,
  setActiveBreakpoint,
} from './editorState.ts';
export type { EditorState, EditorContext } from './editorState.ts';

/* Commands — the edit layer. Every edit knows how to undo itself. */
export { applyCommand, refuse, succeed } from './command.ts';
export type {
  Command,
  CommandOutcome,
  CommandSuccess,
  CommandRefusal,
  EditorEnvironment,
} from './command.ts';

export {
  insertNodeCommand,
  insertSubtreeCommand,
  removeNodeCommand,
  moveNodeCommand,
  restoreNodePositionCommand,
  planDuplicateNode,
  topmostNodes,
  removeNodesCommand,
  reorderNodesCommand,
} from './commands/nodeCommands.ts';
export type { CommandPlan } from './commands/nodeCommands.ts';

/* Transactions — several commands, one history entry (the answer to AUDIT §7.3). */
export { batchCommand } from './commands/batch.ts';

/* Asset library — add, rename, remove metadata records (F3). Bytes live elsewhere. */
export {
  addAssetCommand,
  renameAssetCommand,
  removeAssetCommand,
} from './commands/assetCommands.ts';

export {
  setStylePropertyCommand,
  setStylePropertiesCommand,
  unsetStylePropertyCommand,
} from './commands/styleCommands.ts';
export type { StyleDeclarationInput } from './commands/styleCommands.ts';

export {
  setNodePropCommand,
  unsetNodePropCommand,
  renameNodeCommand,
  setNodeClassesCommand,
  addClassCommand,
  removeClassCommand,
} from './commands/propCommands.ts';

/* History — inverse commands, coalescing, a cap, and context restore. */
export {
  EMPTY_HISTORY,
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_COALESCE_WINDOW_MS,
  createHistory,
  record,
  entryFor,
  undo,
  redo,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
} from './history.ts';
export type { History, HistoryEntry, HistoryStep } from './history.ts';

/* The store — vanilla Zustand. No React; Phase D binds it with useStore. */
export { createEditorStore } from './store.ts';
export type {
  EditorStore,
  EditorStoreState,
  EditorStoreActions,
  EditorStoreOptions,
  SaveState,
} from './store.ts';

/* Autosave — the debounce/trailing policy over the store's save() (F2). */
export { createAutosaveController, DEFAULT_AUTOSAVE_DEBOUNCE_MS } from './autosave.ts';
export type { AutosaveController, AutosaveOptions, TimerHandle } from './autosave.ts';
