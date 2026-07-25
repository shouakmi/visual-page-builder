import {
  TEXT_COMPONENT_ID,
  SECTION_COMPONENT_ID,
  childrenOf,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createNode,
  createProject,
  getComponent,
  insertNode,
  propString,
  setNodeProp,
  setPageTree,
  updatePageBy,
  type ComponentId,
  type IdFactory,
  type Node,
  type NodeId,
} from '@vpb/core';
import { activePage, createEditorStore } from '@vpb/state';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Canvas } from '../Canvas.tsx';

/**
 * THE WHOLE DRAG, END TO END — with the page's layout STUBBED.
 *
 * This drives the real `Canvas` (store, renderer, frame, controller, resolveDrop)
 * through a genuine pointer sequence and asserts the document reorders and commits.
 * The one thing jsdom cannot provide — layout — is stubbed: `elementFromPoint` and
 * each node's `getBoundingClientRect` are given known values, exactly as a laid-out
 * page would report them. So everything except "does a real browser lay this out
 * sensibly" is verified here; that last mile is the manual smoke test in HANDOFF.
 */

const registry = createBuiltinRegistry();

function make(ids: IdFactory, component: ComponentId, text?: string): Node {
  const definition = getComponent(registry, component);
  if (!definition) throw new Error(`registry is missing ${component}`);
  const node = createNode(definition, ids);
  return text === undefined ? node : setNodeProp(node, 'text', propString(text));
}

/** body > section > [a, b, c] text nodes (leaves, so a hover reorders among siblings). */
function buildStore() {
  const ids = createDeterministicIdFactory();
  let project = createProject('Test', ids);
  const home = project.pages[0];
  if (!home) throw new Error('createProject always seeds a page');

  const section = make(ids, SECTION_COMPONENT_ID);
  const a = make(ids, TEXT_COMPONENT_ID, 'A');
  const b = make(ids, TEXT_COMPONENT_ID, 'B');
  const c = make(ids, TEXT_COMPONENT_ID, 'C');
  let tree = home.tree;
  tree = insertNode(tree, section, tree.root);
  tree = insertNode(tree, a, section.id);
  tree = insertNode(tree, b, section.id);
  tree = insertNode(tree, c, section.id);
  project = updatePageBy(project, home.id, (page) => setPageTree(page, tree));

  const store = createEditorStore({ project, env: { registry } });
  return { store, section: section.id, a: a.id, b: b.id, c: c.id };
}

function mount(store: ReturnType<typeof createEditorStore>) {
  const result = render(<Canvas store={store} />);
  const frame = result.container.querySelector('iframe');
  if (!frame) throw new Error('no iframe');
  const doc = frame.contentDocument;
  if (!doc) throw new Error('no frame document');
  return { ...result, doc };
}

function el(doc: Document, id: NodeId): HTMLElement {
  const found = doc.querySelector<HTMLElement>(`[data-vpb-node-id="${id}"]`);
  if (!found) throw new Error(`no element for ${id}`);
  return found;
}

function vrect(top: number, height = 20): DOMRect {
  return {
    top,
    height,
    left: 0,
    width: 100,
    right: 100,
    bottom: top + height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function committedOrder(store: ReturnType<typeof createEditorStore>, parent: NodeId) {
  return childrenOf(activePage(store.getState().committed).tree, parent).map((n) => n.id);
}
function presentOrder(store: ReturnType<typeof createEditorStore>, parent: NodeId) {
  return childrenOf(activePage(store.getState().present).tree, parent).map((n) => n.id);
}

function fire(
  target: EventTarget,
  type: string,
  init: MouseEventInit & { pointerId?: number } = {},
) {
  const { pointerId, ...mouse } = init;
  const event = new MouseEvent(type, { bubbles: true, ...mouse });
  if (pointerId !== undefined) Object.defineProperty(event, 'pointerId', { value: pointerId });
  act(() => {
    target.dispatchEvent(event);
  });
}

/** Stub the frame's layout: which element is under the pointer, and each node's rect. */
function stubLayout(
  doc: Document,
  section: NodeId,
  ids: readonly NodeId[],
  under: NodeId,
): ReturnType<typeof vi.fn> {
  Object.defineProperty(doc, 'elementFromPoint', {
    configurable: true,
    value: () => el(doc, under),
  });
  el(doc, section).getBoundingClientRect = () => vrect(0, 200);
  ids.forEach((id, i) => {
    el(doc, id).getBoundingClientRect = () => vrect(i * 20); // midpoints 10, 30, 50
  });
  const capture = vi.fn();
  Object.defineProperty(doc.documentElement, 'setPointerCapture', {
    configurable: true,
    value: capture,
  });
  Object.defineProperty(doc.documentElement, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
  return capture;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a full drag', () => {
  it('reorders the node and commits exactly one undo entry', () => {
    const { store, section, a, b, c } = buildStore();
    const { doc } = mount(store);
    stubLayout(doc, section, [a, b, c], c);

    fire(el(doc, a), 'pointerdown', { clientX: 0, clientY: 0, pointerId: 7 });
    fire(doc.body, 'pointermove', { clientX: 0, clientY: 8 }); // cross the threshold
    fire(doc.body, 'pointermove', { clientX: 0, clientY: 100 }); // over the end gap -> index 3

    // Previewed, not yet committed.
    expect(presentOrder(store, section)).toEqual([b, c, a]);
    expect(committedOrder(store, section)).toEqual([a, b, c]);

    fire(doc.body, 'pointerup');

    expect(committedOrder(store, section)).toEqual([b, c, a]);
    expect(store.getState().canUndo()).toBe(true);
  });

  it('captures the pointer and shows the shield once dragging begins', () => {
    const { store, section, a, b, c } = buildStore();
    const { doc, container } = mount(store);
    const capture = stubLayout(doc, section, [a, b, c], c);

    fire(el(doc, a), 'pointerdown', { clientX: 0, clientY: 0, pointerId: 7 });
    fire(doc.body, 'pointermove', { clientX: 0, clientY: 100 }); // crosses -> dragging

    expect(capture).toHaveBeenCalledWith(7);
    expect(container.querySelector('.cursor-grabbing')).not.toBeNull();
  });

  it('shows the drop indicator for the resolved target', () => {
    const { store, section, a, b, c } = buildStore();
    const { doc, container } = mount(store);
    stubLayout(doc, section, [a, b, c], c);

    fire(el(doc, a), 'pointerdown', { clientX: 0, clientY: 0, pointerId: 7 });
    fire(doc.body, 'pointermove', { clientX: 0, clientY: 8 });
    fire(doc.body, 'pointermove', { clientX: 0, clientY: 100 });

    const indicator = container.querySelector('[data-vpb-drop-index]');
    expect(indicator?.getAttribute('data-vpb-drop-parent')).toBe(section);
    expect(indicator?.getAttribute('data-vpb-drop-index')).toBe('3');
  });

  it('cancels on Escape — reverting the preview and recording nothing', () => {
    const { store, section, a, b, c } = buildStore();
    const { doc } = mount(store);
    stubLayout(doc, section, [a, b, c], c);

    fire(el(doc, a), 'pointerdown', { clientX: 0, clientY: 0, pointerId: 7 });
    fire(doc.body, 'pointermove', { clientX: 0, clientY: 8 });
    fire(doc.body, 'pointermove', { clientX: 0, clientY: 100 });
    expect(presentOrder(store, section)).toEqual([b, c, a]);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(presentOrder(store, section)).toEqual([a, b, c]);
    expect(committedOrder(store, section)).toEqual([a, b, c]);
    expect(store.getState().canUndo()).toBe(false);
  });

  it('treats a press with no travel as a click, not a drag', () => {
    const { store, section, a, b, c } = buildStore();
    const { doc, container } = mount(store);
    stubLayout(doc, section, [a, b, c], c);

    fire(el(doc, a), 'pointerdown', { clientX: 0, clientY: 0, pointerId: 7 });
    fire(doc.body, 'pointerup');

    expect(committedOrder(store, section)).toEqual([a, b, c]);
    expect(store.getState().canUndo()).toBe(false);
    expect(container.querySelector('[data-vpb-drop-index]')).toBeNull();
  });
});
