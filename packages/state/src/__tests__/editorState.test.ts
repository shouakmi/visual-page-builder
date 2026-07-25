import {
  BASE_BREAKPOINT_ID,
  MOBILE_BREAKPOINT_ID,
  addPage,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createNode,
  createPage,
  createProject,
  insertNode,
  setPageTree,
  updatePageBy,
  BOX_COMPONENT_ID,
  getComponent,
  type IdFactory,
  type NodeId,
  type PageId,
  type Project,
} from '@vpb/core';
import { describe, expect, it } from 'vitest';

import {
  activePage,
  clearSelection,
  createEditorState,
  deselect,
  extendSelection,
  isSelected,
  primarySelection,
  select,
  setActiveBreakpoint,
  setActivePage,
  withContext,
} from '../editorState.ts';

/**
 * A project whose home page has `count` boxes under the body, so selection has
 * something real to point at. Built through core's public API rather than by
 * hand: a hand-built tree would let these tests pass against a tree shape the
 * rest of the system cannot produce.
 */
function projectWithBoxes(count: number, ids: IdFactory = createDeterministicIdFactory()) {
  const registry = createBuiltinRegistry();
  const box = getComponent(registry, BOX_COMPONENT_ID);
  if (!box) throw new Error('builtin registry is missing vpb:box');

  let project = createProject('Test', ids);
  const page = project.pages[0];
  if (!page) throw new Error('createProject must seed a page');

  let tree = page.tree;
  const boxes: NodeId[] = [];
  for (let i = 0; i < count; i++) {
    const node = createNode(box, ids);
    tree = insertNode(tree, node, tree.root, i);
    boxes.push(node.id);
  }

  project = updatePageBy(project, page.id, (p) => setPageTree(p, tree));
  return { project, boxes, pageId: page.id, ids, registry };
}

describe('createEditorState', () => {
  it('opens on the home page at the base breakpoint with nothing selected', () => {
    const { project, pageId } = projectWithBoxes(0);
    const state = createEditorState(project);

    expect(state.context.activePageId).toBe(pageId);
    expect(state.context.activeBreakpointId).toBe(BASE_BREAKPOINT_ID);
    expect(state.context.selection).toEqual([]);
    expect(state.project).toBe(project);
  });

  it('refuses a project with no pages, named', () => {
    // The "at least one page" invariant lives in core's functions, not the type.
    const pageless = { ...createProject('Empty', createDeterministicIdFactory()), pages: [] };
    expect(() => createEditorState(pageless)).toThrow(/no pages/);
  });
});

describe('activePage', () => {
  it('returns the page the context points at', () => {
    const { project, pageId } = projectWithBoxes(1);
    expect(activePage(createEditorState(project)).id).toBe(pageId);
  });

  it('throws when the context points at a page that is gone', () => {
    // A corrupt context is a bug, not a branch. Every consumer would otherwise
    // need a "no active page" path reachable only by that bug.
    const { project } = projectWithBoxes(1);
    const state = createEditorState(project);
    const orphaned = { ...state, context: { ...state.context, activePageId: 'nope' as PageId } };
    expect(() => activePage(orphaned)).toThrow(/not in the project/);
  });
});

describe('select', () => {
  it('selects the given nodes in the order given', () => {
    const { project, boxes } = projectWithBoxes(3);
    const [a, b, c] = boxes as [NodeId, NodeId, NodeId];
    const state = select(createEditorState(project), [c, a]);

    expect(state.context.selection).toEqual([c, a]);
    expect(isSelected(state, c)).toBe(true);
    expect(isSelected(state, b)).toBe(false);
  });

  it('drops ids that are not in the active tree', () => {
    // The tree changes underneath a selection: a command deletes a node, an undo
    // removes one. A selection holding a dead id hands every consumer a
    // `getNode() === undefined` it can do nothing useful with.
    const { project, boxes } = projectWithBoxes(2);
    const [a] = boxes as [NodeId, NodeId];
    const state = select(createEditorState(project), [a, 'ghost' as NodeId]);

    expect(state.context.selection).toEqual([a]);
  });

  it('collapses duplicates, keeping the first occurrence', () => {
    const { project, boxes } = projectWithBoxes(2);
    const [a, b] = boxes as [NodeId, NodeId];
    const state = select(createEditorState(project), [a, b, a]);

    expect(state.context.selection).toEqual([a, b]);
    expect(primarySelection(state)).toBe(a);
  });

  it('replaces the previous selection rather than adding to it', () => {
    const { project, boxes } = projectWithBoxes(2);
    const [a, b] = boxes as [NodeId, NodeId];
    const state = select(select(createEditorState(project), [a]), [b]);

    expect(state.context.selection).toEqual([b]);
  });

  it('leaves the document untouched', () => {
    // Selection is view state. If selecting ever changed the project, history
    // would have to care about clicks — AUDIT 4.3's exact failure.
    const { project, boxes } = projectWithBoxes(1);
    const before = createEditorState(project);
    const after = select(before, [boxes[0] as NodeId]);

    expect(after.project).toBe(before.project);
  });
});

describe('primarySelection', () => {
  it('is the first selected node', () => {
    const { project, boxes } = projectWithBoxes(2);
    const [a, b] = boxes as [NodeId, NodeId];
    expect(primarySelection(select(createEditorState(project), [b, a]))).toBe(b);
  });

  it('is undefined when nothing is selected', () => {
    const { project } = projectWithBoxes(1);
    expect(primarySelection(createEditorState(project))).toBeUndefined();
  });
});

describe('extendSelection', () => {
  it('adds without disturbing what is already selected', () => {
    const { project, boxes } = projectWithBoxes(3);
    const [a, b, c] = boxes as [NodeId, NodeId, NodeId];
    const state = extendSelection(select(createEditorState(project), [a, b]), [c]);

    expect(state.context.selection).toEqual([a, b, c]);
  });

  it('keeps an already-selected id in its original position', () => {
    // Otherwise ctrl-clicking the primary selection twice would move it to the
    // end and silently retarget every single-selection action.
    const { project, boxes } = projectWithBoxes(2);
    const [a, b] = boxes as [NodeId, NodeId];
    const state = extendSelection(select(createEditorState(project), [a, b]), [a]);

    expect(state.context.selection).toEqual([a, b]);
    expect(primarySelection(state)).toBe(a);
  });
});

describe('deselect', () => {
  it('removes only the named ids', () => {
    const { project, boxes } = projectWithBoxes(3);
    const [a, b, c] = boxes as [NodeId, NodeId, NodeId];
    const state = deselect(select(createEditorState(project), [a, b, c]), [b]);

    expect(state.context.selection).toEqual([a, c]);
  });

  it('ignores ids that were not selected', () => {
    const { project, boxes } = projectWithBoxes(2);
    const [a, b] = boxes as [NodeId, NodeId];
    const state = deselect(select(createEditorState(project), [a]), [b]);

    expect(state.context.selection).toEqual([a]);
  });
});

describe('clearSelection', () => {
  it('empties the selection', () => {
    const { project, boxes } = projectWithBoxes(2);
    const state = clearSelection(select(createEditorState(project), boxes));
    expect(state.context.selection).toEqual([]);
  });
});

describe('setActivePage', () => {
  function twoPages(): { project: Project; homeId: PageId; aboutId: PageId } {
    const ids = createDeterministicIdFactory();
    const { project: base } = projectWithBoxes(1, ids);
    const about = createPage('About', '/about', ids);
    const project = addPage(base, about);
    const home = project.pages[0];
    if (!home) throw new Error('unreachable');
    return { project, homeId: home.id, aboutId: about.id };
  }

  it('switches the page', () => {
    const { project, aboutId } = twoPages();
    expect(setActivePage(createEditorState(project), aboutId).context.activePageId).toBe(aboutId);
  });

  it('drops the selection, because node ids are per-tree', () => {
    const { project, aboutId } = twoPages();
    const state = createEditorState(project);
    const selected = select(state, [activePage(state).tree.root]);
    expect(selected.context.selection).not.toEqual([]);

    expect(setActivePage(selected, aboutId).context.selection).toEqual([]);
  });

  it('refuses a page that is not in the project', () => {
    const { project } = twoPages();
    expect(() => setActivePage(createEditorState(project), 'nope' as PageId)).toThrow(
      /not in the project/,
    );
  });
});

describe('setActiveBreakpoint', () => {
  it('switches the emulated device', () => {
    const { project } = projectWithBoxes(1);
    const state = setActiveBreakpoint(createEditorState(project), MOBILE_BREAKPOINT_ID);
    expect(state.context.activeBreakpointId).toBe(MOBILE_BREAKPOINT_ID);
  });

  it('keeps the selection — the nodes are the same nodes', () => {
    const { project, boxes } = projectWithBoxes(2);
    const selected = select(createEditorState(project), boxes);
    const state = setActiveBreakpoint(selected, MOBILE_BREAKPOINT_ID);

    expect(state.context.selection).toEqual(boxes);
  });

  it('leaves the document untouched', () => {
    // AUDIT 4.3: the prototype committed breakpoint switches to history.
    const { project } = projectWithBoxes(1);
    const before = createEditorState(project);
    expect(setActiveBreakpoint(before, MOBILE_BREAKPOINT_ID).project).toBe(before.project);
  });
});

describe('withContext', () => {
  it('patches only the named fields', () => {
    const { project, boxes } = projectWithBoxes(1);
    const state = select(createEditorState(project), boxes);
    const next = withContext(state, { activeBreakpointId: MOBILE_BREAKPOINT_ID });

    expect(next.context.activeBreakpointId).toBe(MOBILE_BREAKPOINT_ID);
    expect(next.context.selection).toEqual(boxes);
    expect(next.context.activePageId).toBe(state.context.activePageId);
  });
});
