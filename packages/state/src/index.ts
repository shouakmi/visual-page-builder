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
