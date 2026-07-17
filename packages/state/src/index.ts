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
