import {
  BOX_COMPONENT_ID,
  childIdsOf,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createNode,
  createProject,
  getComponent,
  insertNode,
  setPageTree,
  updatePageBy,
  type ComponentId,
  type IdFactory,
  type NodeId,
} from '@vpb/core';
import { activePage, createEditorStore, removeNodeCommand } from '@vpb/state';
import { afterEach, describe, expect, it } from 'vitest';

import { createKeyboardController } from '../keyboardController.ts';

/**
 * The shortcut table against a REAL store.
 *
 * Events are dispatched for real so `event.target` is genuine — which is the whole
 * point of the "never hijack typing" test: a synthesised event with no target would
 * pass that guard trivially and prove nothing.
 */

const registry = createBuiltinRegistry();

function make(ids: IdFactory, component: ComponentId) {
  const found = getComponent(registry, component);
  if (!found) throw new Error(`registry is missing ${component}`);
  return createNode(found, ids);
}

/** body > [a, b, c] boxes. */
function buildStore() {
  const ids = createDeterministicIdFactory();
  let project = createProject('Test', ids);
  const home = project.pages[0];
  if (!home) throw new Error('createProject always seeds a page');

  let tree = home.tree;
  const boxes: NodeId[] = [];
  for (let i = 0; i < 3; i++) {
    const box = make(ids, BOX_COMPONENT_ID);
    tree = insertNode(tree, box, tree.root, i);
    boxes.push(box.id);
  }
  project = updatePageBy(project, home.id, (page) => setPageTree(page, tree));

  const store = createEditorStore({ project, env: { registry } });
  return { store, boxes, root: tree.root };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.innerHTML = '';
});

function setup() {
  const built = buildStore();
  const controller = createKeyboardController(built.store);
  const onKeyDown = (event: KeyboardEvent) => controller.handle(event);
  window.addEventListener('keydown', onKeyDown);
  cleanups.push(() => window.removeEventListener('keydown', onKeyDown));
  return built;
}

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function order(store: ReturnType<typeof buildStore>['store'], parent: NodeId) {
  return childIdsOf(activePage(store.getState().committed).tree, parent);
}

describe('delete', () => {
  it('removes the whole selection as exactly one undo entry', () => {
    const { store, boxes, root } = setup();
    const [a, b, c] = boxes;
    if (!a || !b || !c) throw new Error('need three boxes');
    store.getState().select([a, b]);

    const event = press('Delete');

    expect(order(store, root)).toEqual([c]);
    expect(event.defaultPrevented).toBe(true);

    // ONE entry: a single undo brings both back.
    store.getState().undo();
    expect(order(store, root)).toEqual(boxes);
    expect(store.getState().canUndo()).toBe(false);
  });

  it('Backspace deletes too, and never navigates back', () => {
    const { store, boxes, root } = setup();
    const [a] = boxes;
    if (!a) throw new Error('need a box');
    store.getState().select([a]);

    const event = press('Backspace');

    expect(order(store, root)).toEqual([boxes[1], boxes[2]]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does nothing with an empty selection', () => {
    const { store, boxes, root } = setup();
    press('Delete');
    expect(order(store, root)).toEqual(boxes);
    expect(store.getState().canUndo()).toBe(false);
  });
});

describe('arrow reorder', () => {
  it('Left and Up move the selection earlier', () => {
    const { store, boxes, root } = setup();
    const [a, b, c] = boxes;
    if (!a || !b || !c) throw new Error('need three boxes');
    store.getState().select([b]);

    press('ArrowLeft');
    expect(order(store, root)).toEqual([b, a, c]);

    store.getState().select([c]);
    press('ArrowUp');
    expect(order(store, root)).toEqual([b, c, a]);
  });

  it('Right and Down move the selection later', () => {
    const { store, boxes, root } = setup();
    const [a, b, c] = boxes;
    if (!a || !b || !c) throw new Error('need three boxes');
    store.getState().select([a]);

    press('ArrowRight');
    expect(order(store, root)).toEqual([b, a, c]);

    press('ArrowDown');
    expect(order(store, root)).toEqual([b, c, a]);
  });

  it('moves a multi-selection as one entry', () => {
    const { store, boxes, root } = setup();
    const [a, b, c] = boxes;
    if (!a || !b || !c) throw new Error('need three boxes');
    store.getState().select([b, c]);

    press('ArrowLeft');
    expect(order(store, root)).toEqual([b, c, a]);

    store.getState().undo();
    expect(order(store, root)).toEqual(boxes);
  });

  it('does nothing at the boundary', () => {
    const { store, boxes, root } = setup();
    const [a] = boxes;
    if (!a) throw new Error('need a box');
    store.getState().select([a]);

    press('ArrowLeft');

    expect(order(store, root)).toEqual(boxes);
    expect(store.getState().canUndo()).toBe(false);
  });
});

describe('escape', () => {
  it('clears the selection', () => {
    const { store, boxes } = setup();
    const [a] = boxes;
    if (!a) throw new Error('need a box');
    store.getState().select([a]);

    press('Escape');

    expect(store.getState().present.context.selection).toEqual([]);
  });
});

describe('undo and redo', () => {
  it('Ctrl+Z undoes and Ctrl+Shift+Z / Ctrl+Y redo', () => {
    const { store, boxes, root } = setup();
    const [a] = boxes;
    if (!a) throw new Error('need a box');
    store.getState().select([a]);
    press('Delete');
    expect(order(store, root)).toEqual([boxes[1], boxes[2]]);

    press('z', { ctrlKey: true });
    expect(order(store, root)).toEqual(boxes);

    press('z', { ctrlKey: true, shiftKey: true });
    expect(order(store, root)).toEqual([boxes[1], boxes[2]]);

    press('z', { ctrlKey: true });
    expect(order(store, root)).toEqual(boxes);

    press('y', { ctrlKey: true });
    expect(order(store, root)).toEqual([boxes[1], boxes[2]]);
  });

  it('works with the meta key, for macOS', () => {
    const { store, boxes, root } = setup();
    const [a] = boxes;
    if (!a) throw new Error('need a box');
    store.getState().select([a]);
    press('Delete');

    press('z', { metaKey: true });
    expect(order(store, root)).toEqual(boxes);
  });
});

describe('typing is never hijacked', () => {
  it('ignores every shortcut while focus is in a text field', () => {
    const { store, boxes, root } = setup();
    const [a] = boxes;
    if (!a) throw new Error('need a box');
    store.getState().select([a]);

    const input = document.createElement('input');
    document.body.appendChild(input);

    press('Backspace', {}, input);
    press('Delete', {}, input);
    press('ArrowLeft', {}, input);
    press('Escape', {}, input);

    expect(order(store, root)).toEqual(boxes);
    expect(store.getState().present.context.selection).toEqual([a]);
  });

  it('ignores shortcuts inside a contenteditable', () => {
    const { store, boxes, root } = setup();
    const [a] = boxes;
    if (!a) throw new Error('need a box');
    store.getState().select([a]);

    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);

    press('Delete', {}, editable);

    expect(order(store, root)).toEqual(boxes);
  });
});

describe('a gesture in flight owns the keyboard', () => {
  it('declines while a preview is pending, so Escape reverts rather than deselects', () => {
    const { store, boxes, root } = setup();
    const [a, b] = boxes;
    if (!a || !b) throw new Error('need two boxes');
    store.getState().select([a]);
    // Stand in for a drag/resize preview.
    store.getState().preview(removeNodeCommand(b));

    press('Escape');
    expect(store.getState().present.context.selection).toEqual([a]);

    press('Delete');
    expect(order(store, root)).toEqual(boxes);
    expect(store.getState().canUndo()).toBe(false);
  });
});
