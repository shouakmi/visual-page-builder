import {
  BASE_BREAKPOINT_ID,
  BOX_COMPONENT_ID,
  SECTION_COMPONENT_ID,
  childIdsOf,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createNode,
  createProject,
  findRule,
  getComponent,
  insertNode,
  nodeScope,
  px,
  setPageTree,
  setProperty,
  target,
  updatePageBy,
  validateTree,
  type ComponentId,
  type IdFactory,
  type NodeId,
} from '@vpb/core';
import { describe, expect, it } from 'vitest';

import { applyCommand, refuse, succeed, type Command, type EditorEnvironment } from '../command.ts';
import { batchCommand } from '../commands/batch.ts';
import {
  removeNodeCommand,
  removeNodesCommand,
  reorderNodesCommand,
  topmostNodes,
} from '../commands/nodeCommands.ts';
import { activePage, createEditorState, type EditorState } from '../editorState.ts';

/**
 * Batching and the multi-node ops built on it (Phase E4).
 *
 * Headless — a real EditorState, no store and no DOM. The properties that matter
 * are the ones a single-command test cannot see: that N edits become ONE entry,
 * that the combined inverse runs BACKWARDS, and that a refusal anywhere leaves the
 * document untouched.
 */

const registry = createBuiltinRegistry();
const env: EditorEnvironment = { registry };

function make(ids: IdFactory, component: ComponentId) {
  const found = getComponent(registry, component);
  if (!found) throw new Error(`registry is missing ${component}`);
  return createNode(found, ids);
}

/** body > [a, b, c, d] boxes. */
function editorWithBoxes(count: number) {
  const ids = createDeterministicIdFactory();
  let project = createProject('Test', ids);
  const page = project.pages[0];
  if (!page) throw new Error('createProject must seed a page');

  let tree = page.tree;
  const boxes: NodeId[] = [];
  for (let i = 0; i < count; i++) {
    const box = make(ids, BOX_COMPONENT_ID);
    tree = insertNode(tree, box, tree.root, i);
    boxes.push(box.id);
  }
  project = updatePageBy(project, page.id, (p) => setPageTree(p, tree));
  return { state: createEditorState(project), boxes, root: tree.root, ids };
}

/** body > section > [child] — a container holding one node. */
function editorWithNesting() {
  const ids = createDeterministicIdFactory();
  let project = createProject('Test', ids);
  const page = project.pages[0];
  if (!page) throw new Error('createProject must seed a page');

  const section = make(ids, SECTION_COMPONENT_ID);
  const child = make(ids, BOX_COMPONENT_ID);
  let tree = page.tree;
  tree = insertNode(tree, section, tree.root);
  tree = insertNode(tree, child, section.id);
  project = updatePageBy(project, page.id, (p) => setPageTree(p, tree));

  return { state: createEditorState(project), section: section.id, child: child.id, ids };
}

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

function order(state: EditorState, parent: NodeId): readonly NodeId[] {
  return childIdsOf(activePage(state).tree, parent);
}

/** A command that always refuses — for proving atomicity. */
const alwaysRefuses: Command = {
  kind: 'test:refuses',
  label: 'Refuses',
  apply: () => refuse('nope'),
};

/** A command that reports success while changing nothing — the backstop's target. */
const changesNothing: Command = {
  kind: 'test:noop',
  label: 'No-op',
  apply: (state) => succeed(state, alwaysRefuses),
};

describe('batchCommand', () => {
  it('applies every command in order as one outcome', () => {
    const { state, boxes, root } = editorWithBoxes(3);
    const [a, b] = boxes;
    if (!a || !b) throw new Error('need two boxes');

    const { state: next } = run(
      state,
      batchCommand('Delete two', [removeNodeCommand(a), removeNodeCommand(b)]),
    );

    expect(order(next, root)).toEqual([boxes[2]]);
    expect(validateTree(activePage(next).tree)).toEqual([]);
  });

  it('undoes with the inverses REVERSED, restoring original positions', () => {
    // The load-bearing property. Removing a@0 then b@0 (b shifted when a went) only
    // undoes to [a, b, c] if the inverses run backwards.
    const { state, boxes, root } = editorWithBoxes(3);
    const [a, b] = boxes;
    if (!a || !b) throw new Error('need two boxes');

    const { state: deleted, inverse } = run(
      state,
      batchCommand('Delete two', [removeNodeCommand(a), removeNodeCommand(b)]),
    );
    const { state: undone } = run(deleted, inverse);

    expect(order(undone, root)).toEqual(boxes);
  });

  it('is ATOMIC — one refusal leaves the document completely untouched', () => {
    const { state, boxes, root } = editorWithBoxes(3);
    const [a] = boxes;
    if (!a) throw new Error('need a box');

    const reason = refusalOf(
      state,
      batchCommand('Half a delete', [removeNodeCommand(a), alwaysRefuses]),
    );

    expect(reason).toMatch(/nope/);
    // The first command's effect must not survive the second's refusal.
    expect(order(state, root)).toEqual(boxes);
  });

  it('refuses an empty batch rather than record an entry that undoes nothing', () => {
    const { state } = editorWithBoxes(2);
    expect(refusalOf(state, batchCommand('Nothing', []))).toMatch(/at least one command/);
  });

  it("inherits the invoker's backstop for a part that changes nothing", () => {
    const { state } = editorWithBoxes(2);
    expect(refusalOf(state, batchCommand('Vacuous', [changesNothing]))).toMatch(/changed nothing/);
  });

  it('nests', () => {
    const { state, boxes, root } = editorWithBoxes(3);
    const [a, b] = boxes;
    if (!a || !b) throw new Error('need two boxes');

    const { state: next } = run(
      state,
      batchCommand('Outer', [batchCommand('Inner', [removeNodeCommand(a)]), removeNodeCommand(b)]),
    );
    expect(order(next, root)).toEqual([boxes[2]]);
  });

  it('carries no coalesceKey — structural edits never merge', () => {
    const { boxes } = editorWithBoxes(1);
    const [a] = boxes;
    if (!a) throw new Error('need a box');
    expect(batchCommand('Delete', [removeNodeCommand(a)]).coalesceKey).toBeUndefined();
  });
});

describe('topmostNodes', () => {
  it('drops a node whose ancestor is also selected', () => {
    const { state, section, child } = editorWithNesting();
    const tree = activePage(state).tree;
    expect(topmostNodes(tree, [section, child])).toEqual([section]);
  });

  it('keeps unrelated siblings and collapses duplicates', () => {
    const { state, boxes } = editorWithBoxes(3);
    const tree = activePage(state).tree;
    const [a, b] = boxes;
    if (!a || !b) throw new Error('need two boxes');
    expect(topmostNodes(tree, [a, b, a])).toEqual([a, b]);
  });
});

describe('removeNodesCommand', () => {
  it('deletes the whole selection as ONE entry and undoes it whole', () => {
    const { state, boxes, root } = editorWithBoxes(4);
    const [a, , c] = boxes;
    if (!a || !c) throw new Error('need boxes');

    const { state: deleted, inverse } = run(state, removeNodesCommand([a, c]));
    expect(order(deleted, root)).toEqual([boxes[1], boxes[3]]);

    const { state: undone } = run(deleted, inverse);
    expect(order(undone, root)).toEqual(boxes);
  });

  it('restores node-scoped style rules on undo — a delete must not lose styling', () => {
    const { state, boxes } = editorWithBoxes(2);
    const [a] = boxes;
    if (!a) throw new Error('need a box');

    const scope = nodeScope(a);
    const styled: EditorState = {
      ...state,
      project: {
        ...state.project,
        styles: setProperty(
          state.project.styles,
          scope,
          target(BASE_BREAKPOINT_ID),
          'width',
          px(120),
          createDeterministicIdFactory(),
        ),
      },
    };

    const { state: deleted, inverse } = run(styled, removeNodesCommand([a]));
    expect(findRule(deleted.project.styles, scope, target(BASE_BREAKPOINT_ID))).toBeUndefined();

    const { state: undone } = run(deleted, inverse);
    expect(
      findRule(undone.project.styles, scope, target(BASE_BREAKPOINT_ID))?.declarations.width,
    ).toEqual(px(120));
  });

  it('deletes a container once when its child is also selected', () => {
    // Without the topmost filter the child's removal would refuse ("not in the
    // tree") and atomicity would sink the whole delete.
    const { state, section, child } = editorWithNesting();
    const root = activePage(state).tree.root;

    const { state: deleted } = run(state, removeNodesCommand([section, child]));
    expect(order(deleted, root)).toEqual([]);
  });

  it('drops the deleted nodes from the selection', () => {
    const { state, boxes } = editorWithBoxes(3);
    const [a, b] = boxes;
    if (!a || !b) throw new Error('need two boxes');

    const selected: EditorState = { ...state, context: { ...state.context, selection: [a, b] } };
    const { state: deleted } = run(selected, removeNodesCommand([a, b]));
    expect(deleted.context.selection).toEqual([]);
  });

  it('refuses an empty selection and refuses the root', () => {
    const { state, root } = editorWithBoxes(2);
    expect(refusalOf(state, removeNodesCommand([]))).toMatch(/Nothing to delete/);
    expect(refusalOf(state, removeNodesCommand([root]))).toMatch(/root cannot be deleted/);
  });
});

describe('reorderNodesCommand', () => {
  it('moves one node earlier and later', () => {
    const { state, boxes, root } = editorWithBoxes(3);
    const [a, b, c] = boxes;
    if (!a || !b || !c) throw new Error('need three boxes');

    const { state: earlier } = run(state, reorderNodesCommand([b], -1));
    expect(order(earlier, root)).toEqual([b, a, c]);

    const { state: later } = run(state, reorderNodesCommand([b], 1));
    expect(order(later, root)).toEqual([a, c, b]);
  });

  it('moves several selected nodes without them colliding', () => {
    // [a,b,c,d] with b and c selected: earlier -> [b,c,a,d], later -> [a,d,b,c].
    const { state, boxes, root } = editorWithBoxes(4);
    const [a, b, c, d] = boxes;
    if (!a || !b || !c || !d) throw new Error('need four boxes');

    const { state: earlier } = run(state, reorderNodesCommand([b, c], -1));
    expect(order(earlier, root)).toEqual([b, c, a, d]);

    const { state: later } = run(state, reorderNodesCommand([b, c], 1));
    expect(order(later, root)).toEqual([a, d, b, c]);
  });

  it('undoes to the original order as one entry', () => {
    const { state, boxes, root } = editorWithBoxes(4);
    const [b, c] = [boxes[1], boxes[2]];
    if (!b || !c) throw new Error('need boxes');

    const { state: moved, inverse } = run(state, reorderNodesCommand([b, c], 1));
    const { state: undone } = run(moved, inverse);
    expect(order(undone, root)).toEqual(boxes);
  });

  it('refuses at the boundary rather than record an invisible entry', () => {
    const { state, boxes } = editorWithBoxes(3);
    const [a, , c] = boxes;
    if (!a || !c) throw new Error('need boxes');

    expect(refusalOf(state, reorderNodesCommand([a], -1))).toMatch(/Already first/);
    expect(refusalOf(state, reorderNodesCommand([c], 1))).toMatch(/Already last/);
  });

  it('refuses the whole move if any selected node is stuck', () => {
    const { state, boxes, root } = editorWithBoxes(3);
    const [a, b] = boxes;
    if (!a || !b) throw new Error('need boxes');

    expect(refusalOf(state, reorderNodesCommand([a, b], -1))).toMatch(/Already first/);
    expect(order(state, root)).toEqual(boxes);
  });

  it('carries NO coalesceKey — a relative command must never coalesce', () => {
    // history.ts's `merge` takes the later entry's redo wholesale, which is only
    // valid for commands that assign. Coalescing two "move later" steps would redo
    // one step and land in the wrong place.
    const { boxes } = editorWithBoxes(2);
    const [a] = boxes;
    if (!a) throw new Error('need a box');
    expect(reorderNodesCommand([a], 1).coalesceKey).toBeUndefined();
  });

  it('refuses an empty selection', () => {
    const { state } = editorWithBoxes(2);
    expect(refusalOf(state, reorderNodesCommand([], 1))).toMatch(/Nothing to move/);
  });
});
