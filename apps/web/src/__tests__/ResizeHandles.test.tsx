import {
  BASE_BREAKPOINT_ID,
  BOX_COMPONENT_ID,
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
  target,
  updatePageBy,
  type ComponentId,
  type IdFactory,
  type Node,
  type NodeId,
} from '@vpb/core';
import { createEditorStore } from '@vpb/state';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Canvas } from '../Canvas.tsx';

/**
 * THE RESIZE, END TO END — with the box's layout STUBBED.
 *
 * Drives the real `Canvas` (store, renderer, frame, ResizeHandles, controller)
 * through a genuine pointer sequence on a grip and asserts width/height preview and
 * commit. The one thing jsdom cannot provide — layout — is stubbed: the box's
 * `getBoundingClientRect` reports a known start size, exactly as a laid-out page
 * would. Everything except "does a real browser lay this out sensibly" is verified
 * here; that last mile is the manual smoke test in HANDOFF.
 */

const registry = createBuiltinRegistry();

function make(ids: IdFactory, component: ComponentId): Node {
  const definition = getComponent(registry, component);
  if (!definition) throw new Error(`registry is missing ${component}`);
  return createNode(definition, ids);
}

/** body > box. */
function buildStore() {
  const ids = createDeterministicIdFactory();
  let project = createProject('Test', ids);
  const home = project.pages[0];
  if (!home) throw new Error('createProject always seeds a page');

  const box = make(ids, BOX_COMPONENT_ID);
  project = updatePageBy(project, home.id, (page) =>
    setPageTree(page, insertNode(home.tree, box, home.tree.root)),
  );

  const store = createEditorStore({ project, env: { registry } });
  return { store, box: box.id };
}

function mount(store: ReturnType<typeof createEditorStore>) {
  const result = render(<Canvas store={store} />);
  const frame = result.container.querySelector('iframe');
  if (!frame) throw new Error('no iframe');
  const doc = frame.contentDocument;
  if (!doc) throw new Error('no frame document');
  return { ...result, doc };
}

function boxEl(doc: Document, id: NodeId): HTMLElement {
  const found = doc.querySelector<HTMLElement>(`[data-vpb-node-id="${id}"]`);
  if (!found) throw new Error(`no element for ${id}`);
  return found;
}

function rect(width: number, height: number): DOMRect {
  return {
    top: 0,
    left: 0,
    width,
    height,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function grip(container: HTMLElement, handle: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[data-vpb-resize-handle="${handle}"]`);
  if (!found) throw new Error(`no grip for ${handle}`);
  return found;
}

function sizeOf(
  store: ReturnType<typeof createEditorStore>,
  which: 'present' | 'committed',
  box: NodeId,
) {
  const state = which === 'present' ? store.getState().present : store.getState().committed;
  return findRule(state.project.styles, nodeScope(box), target(BASE_BREAKPOINT_ID))?.declarations;
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resize grips', () => {
  it('appear for a single selection and vanish for none', () => {
    const { store, box } = buildStore();
    const { container, doc } = mount(store);
    boxEl(doc, box).getBoundingClientRect = () => rect(100, 50);

    expect(container.querySelectorAll('[data-vpb-resize-handle]')).toHaveLength(0);

    act(() => store.getState().select([box]));
    expect(container.querySelectorAll('[data-vpb-resize-handle]')).toHaveLength(8);

    act(() => store.getState().clearSelection());
    expect(container.querySelectorAll('[data-vpb-resize-handle]')).toHaveLength(0);
  });
});

describe('a full resize', () => {
  it('previews width/height then commits exactly one undo entry', () => {
    const { store, box } = buildStore();
    const { container, doc } = mount(store);
    boxEl(doc, box).getBoundingClientRect = () => rect(100, 50);
    act(() => store.getState().select([box]));

    const se = grip(container, 'se');
    fire(se, 'pointerdown', { clientX: 100, clientY: 50, pointerId: 5 });
    fire(se, 'pointermove', { clientX: 140, clientY: 70 }); // +40 x +20, past threshold

    // Previewed, not yet committed.
    expect(sizeOf(store, 'present', box)).toEqual({ width: px(140), height: px(70) });
    expect(sizeOf(store, 'committed', box)).toBeUndefined();

    fire(se, 'pointerup');

    expect(sizeOf(store, 'committed', box)).toEqual({ width: px(140), height: px(70) });
    expect(store.getState().canUndo()).toBe(true);
  });

  it('drives the grip that was grabbed — the west edge grows leftward', () => {
    const { store, box } = buildStore();
    const { container, doc } = mount(store);
    boxEl(doc, box).getBoundingClientRect = () => rect(100, 50);
    act(() => store.getState().select([box]));

    const w = grip(container, 'w');
    fire(w, 'pointerdown', { clientX: 0, clientY: 25, pointerId: 5 });
    fire(w, 'pointermove', { clientX: -30, clientY: 25 }); // drag left -> width 130
    fire(w, 'pointerup');

    expect(sizeOf(store, 'committed', box)).toEqual({ width: px(130), height: px(50) });
  });

  it('cancels on Escape — reverting the preview and recording nothing', () => {
    const { store, box } = buildStore();
    const { container, doc } = mount(store);
    boxEl(doc, box).getBoundingClientRect = () => rect(100, 50);
    act(() => store.getState().select([box]));

    const se = grip(container, 'se');
    fire(se, 'pointerdown', { clientX: 100, clientY: 50, pointerId: 5 });
    fire(se, 'pointermove', { clientX: 140, clientY: 70 });
    expect(sizeOf(store, 'present', box)).toEqual({ width: px(140), height: px(70) });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(sizeOf(store, 'present', box)).toBeUndefined();
    expect(store.getState().canUndo()).toBe(false);
  });

  it('treats a grab with no travel as a click, not a resize', () => {
    const { store, box } = buildStore();
    const { container, doc } = mount(store);
    boxEl(doc, box).getBoundingClientRect = () => rect(100, 50);
    act(() => store.getState().select([box]));

    const se = grip(container, 'se');
    fire(se, 'pointerdown', { clientX: 100, clientY: 50, pointerId: 5 });
    fire(se, 'pointerup');

    expect(sizeOf(store, 'committed', box)).toBeUndefined();
    expect(store.getState().canUndo()).toBe(false);
  });
});
