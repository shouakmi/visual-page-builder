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
} from './commands/nodeCommands.ts';

export { setStylePropertyCommand, unsetStylePropertyCommand } from './commands/styleCommands.ts';

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
} from './store.ts';
