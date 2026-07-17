import type { BreakpointId, NodeId, PageId, Page, Project } from '@vpb/core';
import { BASE_BREAKPOINT_ID, getPage, homePage } from '@vpb/core';

/**
 * WHAT THE EDITOR IS LOOKING AT, as opposed to what the document contains.
 *
 * This split is the whole reason undo is usable. AUDIT §4.3 found the prototype
 * committing selection to history (`select = (id) => commit({...state, selectedId: id})`)
 * and breakpoint switches too, so Ctrl+Z undid *clicks* — the feature was
 * destroyed by putting view state in the document's history.
 *
 * So: nothing in here is a document edit, and changing any of it is never a
 * history entry. But a history entry RECORDS the context an edit happened in and
 * restores it on undo, because an undo that leaves the wrong node selected — or
 * leaves you on a different page from the change you just reverted — silently
 * retargets the user's next edit. Recording context is the opposite of
 * committing it.
 */
export interface EditorContext {
  /**
   * ORDERED, and a list rather than a Set: "align to the first selected" and
   * shift-click range extension both depend on the order the user picked, and
   * Phase E's multi-select builds directly on this. Empty means nothing selected,
   * which is a normal state, not a missing one.
   */
  readonly selection: readonly NodeId[];
  /** The page being edited. Always a page that exists in the project. */
  readonly activePageId: PageId;
  /**
   * The device the canvas is emulating. A VIEW concern: it decides which
   * breakpoint an edit writes to and which media query the canvas simulates, and
   * switching it changes nothing in the document.
   */
  readonly activeBreakpointId: BreakpointId;
}

/**
 * The committed editor state: the document, plus where the user is in it.
 *
 * `project` is the only part that history rewinds. `context` rides along so undo
 * can put the user back where the edit happened.
 */
export interface EditorState {
  readonly project: Project;
  readonly context: EditorContext;
}

/**
 * Open a project for editing, focused on its home page at the base breakpoint.
 *
 * `createProject` seeds a home page and `removePage` refuses to delete the last
 * one, so a project always has at least one page — but that invariant lives in
 * core's functions, not in the `Project` type, which types `pages` as a plain
 * array. Rather than assume, assert: a hand-built or deserialised project with no
 * pages fails here, named, instead of producing a context pointing at `undefined`
 * that only explodes later in `activePage`.
 */
export function createEditorState(project: Project): EditorState {
  const home = homePage(project);
  if (!home) {
    throw new Error('Cannot edit a project with no pages. createProject() always makes one.');
  }
  return {
    project,
    context: {
      selection: [],
      activePageId: home.id,
      activeBreakpointId: BASE_BREAKPOINT_ID,
    },
  };
}

/* ---------------------------------------------------------------- reading */

/**
 * The page being edited.
 *
 * Throws rather than returning undefined. `activePageId` pointing at a page that
 * does not exist is a corrupt context, not a condition callers should branch on:
 * every command, the canvas, and the layer panel would each need a "no active
 * page" path that can only be reached by a bug. `removePage` is responsible for
 * moving the context off a page it deletes — this is the assertion that says so.
 */
export function activePage(state: EditorState): Page {
  const page = getPage(state.project, state.context.activePageId);
  if (!page) {
    throw new Error(
      `Active page ${state.context.activePageId} is not in the project. ` +
        'A command removed a page without moving the context off it.',
    );
  }
  return page;
}

export function isSelected(state: EditorState, id: NodeId): boolean {
  return state.context.selection.includes(id);
}

/** The first selected node, which is what single-selection UI acts on. */
export function primarySelection(state: EditorState): NodeId | undefined {
  return state.context.selection[0];
}

/* ---------------------------------------------------------------- context */

/**
 * Context updates are plain functions, NOT commands, and that is the point.
 *
 * They return a new state and never touch history. See `EditorContext`.
 */
export function withContext(state: EditorState, context: Partial<EditorContext>): EditorState {
  return { ...state, context: { ...state.context, ...context } };
}

/**
 * Select exactly these nodes.
 *
 * Ids not present in the active page's tree are dropped rather than rejected: a
 * selection is a view of the tree, and the tree can change underneath it (another
 * command deleted the node, an undo removed it). A selection holding a dead id
 * would hand every consumer a `getNode(...) === undefined` it cannot do anything
 * useful about. Duplicates are collapsed, first occurrence winning, so the
 * primary selection is stable.
 */
export function select(state: EditorState, ids: readonly NodeId[]): EditorState {
  const { nodes } = activePage(state).tree;
  const selection: NodeId[] = [];
  for (const id of ids) {
    if (nodes.has(id) && !selection.includes(id)) selection.push(id);
  }
  return withContext(state, { selection });
}

export function clearSelection(state: EditorState): EditorState {
  return withContext(state, { selection: [] });
}

/**
 * Add to the selection without disturbing what is already selected — ctrl-click.
 * Already-selected ids keep their original position, so the primary selection
 * does not jump when the user ctrl-clicks something twice.
 */
export function extendSelection(state: EditorState, ids: readonly NodeId[]): EditorState {
  return select(state, [...state.context.selection, ...ids]);
}

export function deselect(state: EditorState, ids: readonly NodeId[]): EditorState {
  const removing = new Set(ids);
  return select(
    state,
    state.context.selection.filter((id) => !removing.has(id)),
  );
}

/**
 * Switch pages. Selection does not survive, because node ids are per-tree and a
 * selection carried across pages would point at nodes the user cannot see.
 */
export function setActivePage(state: EditorState, id: PageId): EditorState {
  if (!getPage(state.project, id)) {
    throw new Error(`Cannot activate page ${id}: not in the project.`);
  }
  return withContext(state, { activePageId: id, selection: [] });
}

/** Switch the emulated device. Selection survives: the nodes are the same nodes. */
export function setActiveBreakpoint(state: EditorState, id: BreakpointId): EditorState {
  return withContext(state, { activeBreakpointId: id });
}
