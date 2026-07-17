import {
  BOX_COMPONENT_ID,
  IMAGE_COMPONENT_ID,
  TEXT_COMPONENT_ID,
  childIdsOf,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createNode,
  createProject,
  getComponent,
  getNode,
  insertNode,
  nodeScope,
  orphanedNodeScopes,
  px,
  rulesForScope,
  setPageTree,
  setProperty,
  target,
  unknownComponentNodes,
  updatePageBy,
  validateProject,
  validateTree,
  BASE_BREAKPOINT_ID,
  type ComponentDefinition,
  type IdFactory,
  type Node,
  type NodeId,
} from '@vpb/core';
import { describe, expect, it } from 'vitest';

import { applyCommand, type Command, type EditorEnvironment } from '../command.ts';
import {
  insertNodeCommand,
  insertSubtreeCommand,
  moveNodeCommand,
  removeNodeCommand,
  restoreNodePositionCommand,
} from '../commands/nodeCommands.ts';
import { activePage, createEditorState, type EditorState } from '../editorState.ts';

const registry = createBuiltinRegistry();
const env: EditorEnvironment = { registry };

function definition(id: typeof BOX_COMPONENT_ID): ComponentDefinition {
  const found = getComponent(registry, id);
  if (!found) throw new Error(`builtin registry is missing ${id}`);
  return found;
}

/** A page with `count` boxes under the body. */
function editorWith(count: number, ids: IdFactory = createDeterministicIdFactory()) {
  let project = createProject('Test', ids);
  const page = project.pages[0];
  if (!page) throw new Error('createProject must seed a page');

  let tree = page.tree;
  const boxes: NodeId[] = [];
  for (let i = 0; i < count; i++) {
    const box = createNode(definition(BOX_COMPONENT_ID), ids);
    tree = insertNode(tree, box, tree.root, i);
    boxes.push(box.id);
  }

  project = updatePageBy(project, page.id, (p) => setPageTree(p, tree));
  return { state: createEditorState(project), boxes, ids, root: tree.root };
}

/** Apply, requiring success. Returns the new state and the inverse. */
function run(state: EditorState, command: Command): { state: EditorState; inverse: Command } {
  const outcome = applyCommand(state, command, env);
  if (!outcome.ok) throw new Error(`expected success, got refusal: ${outcome.reason}`);
  return { state: outcome.state, inverse: outcome.inverse };
}

function refusalOf(state: EditorState, command: Command): string {
  const outcome = applyCommand(state, command, env);
  if (outcome.ok) throw new Error('expected a refusal, got success');
  return outcome.reason;
}

const childrenOfRoot = (state: EditorState): readonly NodeId[] =>
  childIdsOf(activePage(state).tree, activePage(state).tree.root);

/** Put one node-scoped rule on a node, so deletion has styling to account for. */
function styleNode(state: EditorState, id: NodeId, ids: IdFactory): EditorState {
  return {
    ...state,
    project: {
      ...state.project,
      styles: setProperty(
        state.project.styles,
        nodeScope(id),
        target(BASE_BREAKPOINT_ID),
        'width',
        px(100),
        ids,
      ),
    },
  };
}

/**
 * Every command must leave the document internally consistent.
 *
 * `validateTree` re-derives the parent index from the `children` arrays and
 * asserts they agree — the invariant B3 maintains incrementally on every
 * mutation. Running it after each command here is how this layer proves it did
 * not break the thing core is careful about. `unknownComponentNodes` catches a
 * node pointing at a component the registry does not have.
 */
function expectConsistent(state: EditorState) {
  expect(validateTree(activePage(state).tree)).toEqual([]);
  expect(validateProject(state.project)).toEqual([]);
  expect(unknownComponentNodes(activePage(state).tree, registry)).toEqual([]);
  expect(orphanedNodeScopes(state.project)).toEqual([]);
}

describe('insertNodeCommand', () => {
  it('inserts at the given index and selects the new node', () => {
    const { state, boxes, ids } = editorWith(2);
    const node = createNode(definition(BOX_COMPONENT_ID), ids);

    const { state: next } = run(state, insertNodeCommand(node, activePage(state).tree.root, 1));

    expect(childrenOfRoot(next)).toEqual([boxes[0], node.id, boxes[1]]);
    expect(next.context.selection).toEqual([node.id]);
    expectConsistent(next);
  });

  it('appends when no index is given', () => {
    const { state, boxes, ids } = editorWith(2);
    const node = createNode(definition(BOX_COMPONENT_ID), ids);
    const { state: next } = run(state, insertNodeCommand(node, activePage(state).tree.root));

    expect(childrenOfRoot(next)).toEqual([...boxes, node.id]);
  });

  it('undoes to exactly the state before', () => {
    const { state, ids } = editorWith(2);
    const node = createNode(definition(BOX_COMPONENT_ID), ids);

    const { state: inserted, inverse } = run(
      state,
      insertNodeCommand(node, activePage(state).tree.root, 0),
    );
    const { state: undone } = run(inserted, inverse);

    expect(childrenOfRoot(undone)).toEqual(childrenOfRoot(state));
    expectConsistent(undone);
  });

  it('redoes with the SAME node id', () => {
    // The whole reason the node is minted by the caller. A redo that re-minted
    // would orphan every node-scoped rule written against the first id.
    const { state, ids } = editorWith(1);
    const node = createNode(definition(BOX_COMPONENT_ID), ids);

    const { state: inserted, inverse } = run(
      state,
      insertNodeCommand(node, activePage(state).tree.root),
    );
    const { state: undone, inverse: redo } = run(inserted, inverse);
    const { state: redone } = run(undone, redo);

    expect(childrenOfRoot(redone)).toEqual(childrenOfRoot(inserted));
    expect(getNode(activePage(redone).tree, node.id)).toBeDefined();
  });

  it('refuses a component the parent cannot contain, saying so', () => {
    // vpb:image is a leaf. AUDIT: the prototype ignored allowedParents entirely.
    const { state, ids } = editorWith(0);
    const image = createNode(definition(IMAGE_COMPONENT_ID), ids);
    const { state: withImage } = run(state, insertNodeCommand(image, activePage(state).tree.root));

    const text = createNode(definition(TEXT_COMPONENT_ID), ids);
    expect(refusalOf(withImage, insertNodeCommand(text, image.id))).toMatch(/cannot contain/i);
  });

  it('refuses a node already in the tree', () => {
    const { state, ids } = editorWith(0);
    const node = createNode(definition(BOX_COMPONENT_ID), ids);
    const { state: next } = run(state, insertNodeCommand(node, activePage(state).tree.root));

    expect(refusalOf(next, insertNodeCommand(node, activePage(next).tree.root))).toMatch(
      /already in the tree/,
    );
  });

  it('refuses an unknown parent', () => {
    const { state, ids } = editorWith(0);
    const node = createNode(definition(BOX_COMPONENT_ID), ids);
    expect(refusalOf(state, insertNodeCommand(node, 'ghost' as NodeId))).toMatch(/not in the tree/);
  });
});

describe('removeNodeCommand', () => {
  it('removes the node and drops it from the selection', () => {
    const { state, boxes } = editorWith(2);
    const [a, b] = boxes as [NodeId, NodeId];
    const { state: next } = run(state, removeNodeCommand(a));

    expect(childrenOfRoot(next)).toEqual([b]);
    expect(next.context.selection).toEqual([]);
    expectConsistent(next);
  });

  it('refuses to delete the page root', () => {
    const { state } = editorWith(1);
    expect(refusalOf(state, removeNodeCommand(activePage(state).tree.root))).toMatch(
      /root cannot be deleted/,
    );
  });

  it('refuses an unknown node', () => {
    const { state } = editorWith(1);
    expect(refusalOf(state, removeNodeCommand('ghost' as NodeId))).toMatch(/not in the tree/);
  });

  it('restores the subtree, its ids, and its position on undo', () => {
    const { state, boxes, ids } = editorWith(2);
    const [a, b] = boxes as [NodeId, NodeId];

    // Give `a` a child so the subtree is more than one node.
    const child = createNode(definition(TEXT_COMPONENT_ID), ids);
    const { state: seeded } = run(state, insertNodeCommand(child, a));

    const { state: removed, inverse } = run(seeded, removeNodeCommand(a));
    expect(childrenOfRoot(removed)).toEqual([b]);

    const { state: undone } = run(removed, inverse);
    expect(childrenOfRoot(undone)).toEqual([a, b]);
    expect(childIdsOf(activePage(undone).tree, a)).toEqual([child.id]);
    expectConsistent(undone);
  });

  it('deletes the node-scoped style rules with the node', () => {
    // Otherwise they outlive it forever and bloat every export.
    const { state, boxes, ids } = editorWith(1);
    const [a] = boxes as [NodeId];
    const styled = styleNode(state, a, ids);
    expect(rulesForScope(styled.project.styles, nodeScope(a))).toHaveLength(1);

    const { state: removed } = run(styled, removeNodeCommand(a));
    expect(rulesForScope(removed.project.styles, nodeScope(a))).toEqual([]);
    expect(orphanedNodeScopes(removed.project)).toEqual([]);
  });

  it('brings the style rules back on undo — a delete must not silently unstyle', () => {
    const { state, boxes, ids } = editorWith(1);
    const [a] = boxes as [NodeId];
    const styled = styleNode(state, a, ids);

    const { state: removed, inverse } = run(styled, removeNodeCommand(a));
    const { state: undone } = run(removed, inverse);

    const rules = rulesForScope(undone.project.styles, nodeScope(a));
    expect(rules).toHaveLength(1);
    expect(rules[0]?.declarations).toEqual(
      rulesForScope(styled.project.styles, nodeScope(a))[0]?.declarations,
    );
  });
});

describe('moveNodeCommand', () => {
  it('reparents a node', () => {
    const { state, boxes } = editorWith(2);
    const [a, b] = boxes as [NodeId, NodeId];
    const { state: next } = run(state, moveNodeCommand(a, b));

    expect(childrenOfRoot(next)).toEqual([b]);
    expect(childIdsOf(activePage(next).tree, b)).toEqual([a]);
    expectConsistent(next);
  });

  it('refuses to move a node into its own descendant, saying why', () => {
    // The cycle that detaches the branch into a self-referencing ring.
    const { state, boxes } = editorWith(2);
    const [a, b] = boxes as [NodeId, NodeId];
    const { state: nested } = run(state, moveNodeCommand(b, a));

    expect(refusalOf(nested, moveNodeCommand(a, b))).toMatch(/own descendant/);
  });

  it('refuses to move the root', () => {
    const { state, boxes } = editorWith(1);
    const [a] = boxes as [NodeId];
    expect(refusalOf(state, moveNodeCommand(activePage(state).tree.root, a))).toMatch(
      /root cannot be moved/,
    );
  });

  it('undoes a reparent back to the original parent and index', () => {
    const { state, boxes } = editorWith(3);
    const [a, b] = boxes as [NodeId, NodeId, NodeId];

    const { state: moved, inverse } = run(state, moveNodeCommand(b, a, 0));
    const { state: undone } = run(moved, inverse);

    expect(childrenOfRoot(undone)).toEqual(childrenOfRoot(state));
    expect(childIdsOf(activePage(undone).tree, a)).toEqual([]);
    expectConsistent(undone);
  });

  /**
   * THE CASE THAT MAKES THE INVERSE NON-OBVIOUS.
   *
   * `moveNode`'s index is a position in the list as the user sees it, before the
   * move; the inverse knows only where the node must END UP. For a reparent the
   * two agree, so a wrong inverse still passes. Only same-parent reorders expose
   * it — which is why every position is tested rather than one.
   */
  describe('same-parent reorder round-trips from every position to every other', () => {
    const positions = [0, 1, 2, 3];
    for (const from of positions) {
      for (const to of positions) {
        it(`index ${from} -> drop at ${to} and back`, () => {
          const { state, boxes, root } = editorWith(4);
          const before = childrenOfRoot(state);
          const node = boxes[from] as NodeId;

          const { state: moved, inverse } = run(state, moveNodeCommand(node, root, to));
          const { state: undone } = run(moved, inverse);

          expect(undone.context.selection).toEqual(state.context.selection);
          expect(childrenOfRoot(undone)).toEqual(before);
          expectConsistent(undone);
        });
      }
    }
  });

  it('redoes a same-parent reorder to the same order', () => {
    const { state, boxes, root } = editorWith(4);
    const node = boxes[0] as NodeId;

    const { state: moved, inverse } = run(state, moveNodeCommand(node, root, 3));
    const orderAfterMove = childrenOfRoot(moved);

    const { state: undone, inverse: redo } = run(moved, inverse);
    const { state: redone } = run(undone, redo);

    expect(childrenOfRoot(redone)).toEqual(orderAfterMove);
  });
});

describe('restoreNodePositionCommand', () => {
  it('places a node at an exact final index', () => {
    const { state, boxes, root } = editorWith(4);
    const [a, b, c, d] = boxes as [NodeId, NodeId, NodeId, NodeId];

    const { state: next } = run(state, restoreNodePositionCommand(a, root, 2));
    expect(childrenOfRoot(next)).toEqual([b, c, a, d]);
  });

  it('places a node at index 0', () => {
    const { state, boxes, root } = editorWith(3);
    const [a, b, c] = boxes as [NodeId, NodeId, NodeId];

    const { state: next } = run(state, restoreNodePositionCommand(c, root, 0));
    expect(childrenOfRoot(next)).toEqual([c, a, b]);
  });
});

describe('insertSubtreeCommand', () => {
  it('refuses a subtree whose root is already present', () => {
    const { state, boxes } = editorWith(1);
    const [a] = boxes as [NodeId];
    const node = getNode(activePage(state).tree, a) as Node;

    expect(
      refusalOf(state, insertSubtreeCommand([node], a, activePage(state).tree.root, 0)),
    ).toMatch(/already in the tree/);
  });
});

describe('applyCommand — the invoker', () => {
  it('rejects a command that reports success but changed nothing', () => {
    // @vpb/core refuses by returning its input, so a command that forgets a
    // precondition would hand history an entry whose undo does nothing.
    const { state } = editorWith(1);
    const liar: Command = {
      kind: 'liar',
      label: 'Lie',
      apply: (current) => ({ ok: true, state: current, inverse: liar }),
    };

    const outcome = applyCommand(state, liar, env);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toMatch(/changed nothing/);
  });

  it('passes a genuine refusal through untouched', () => {
    const { state } = editorWith(1);
    const reason = refusalOf(state, removeNodeCommand(activePage(state).tree.root));
    expect(reason).toMatch(/root cannot be deleted/);
  });
});
