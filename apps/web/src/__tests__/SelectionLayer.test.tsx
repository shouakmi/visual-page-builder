import {
  BOX_COMPONENT_ID,
  HEADING_COMPONENT_ID,
  SECTION_COMPONENT_ID,
  createBuiltinRegistry,
  createIdFactory,
  createNode,
  createProject,
  getComponent,
  insertNode,
  propString,
  setNodeProp,
  setPageTree,
  updatePageBy,
  type ComponentId,
  type Node,
  type NodeId,
  type Project,
} from '@vpb/core';
import { createEditorStore } from '@vpb/state';
import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Canvas } from '../Canvas.tsx';

/**
 * E1 — selection + overlay.
 *
 * Drives the real `Canvas` (real store, renderer, sandboxed frame) and asserts on
 * store selection and overlay structure, never pixels: jsdom does no layout, so
 * every `getBoundingClientRect` is zero. What matters here is which node a click
 * selects and which nodes get a box — both of which are size-independent.
 *
 * Clicks are dispatched as `pointerdown` into the frame document, exactly where a
 * real click lands. A `MouseEvent` typed `pointerdown` carries the modifier keys a
 * bare `Event` cannot, and jsdom has no `PointerEvent` constructor.
 */

function buildProject(): { project: Project; headingId: NodeId; boxId: NodeId } {
  const ids = createIdFactory();
  const registry = createBuiltinRegistry();
  const make = (component: ComponentId): Node => {
    const definition = getComponent(registry, component);
    if (!definition) throw new Error(`builtin registry is missing ${component}`);
    return createNode(definition, ids);
  };

  let project = createProject('Test', ids);
  const home = project.pages[0];
  if (!home) throw new Error('createProject always seeds a page');

  // body > section > [heading, box] — two selectable siblings.
  const section = make(SECTION_COMPONENT_ID);
  const heading = setNodeProp(make(HEADING_COMPONENT_ID), 'text', propString('HEADING'));
  const box = make(BOX_COMPONENT_ID);
  let tree = home.tree;
  tree = insertNode(tree, section, tree.root);
  tree = insertNode(tree, heading, section.id);
  tree = insertNode(tree, box, section.id);
  project = updatePageBy(project, home.id, (page) => setPageTree(page, tree));

  return { project, headingId: heading.id, boxId: box.id };
}

function makeStore(project: Project) {
  return createEditorStore({ project, env: { registry: createBuiltinRegistry() } });
}

function mount(store: ReturnType<typeof createEditorStore>) {
  const result = render(<Canvas store={store} />);
  const frame = result.container.querySelector('iframe');
  if (!frame) throw new Error('the canvas rendered no iframe');
  const doc = frame.contentDocument;
  if (!doc) throw new Error('the frame has no document');
  return { ...result, doc };
}

function handle(doc: Document, id: NodeId): Element {
  const element = doc.querySelector(`[data-vpb-node-id="${id}"]`);
  if (!element) throw new Error(`no rendered element for node ${id}`);
  return element;
}

/** Press inside the frame. Wrapped in act so the store update and overlay re-render flush. */
function press(target: Element, init: MouseEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, ...init }));
  });
}

describe('click to select', () => {
  it('selects the node you press', () => {
    const { project, headingId } = buildProject();
    const store = makeStore(project);
    const { doc } = mount(store);

    press(handle(doc, headingId));

    expect(store.getState().present.context.selection).toEqual([headingId]);
  });

  it('selects the nearest node when you press a descendant with no handle of its own', () => {
    // A component with inner markup (a card, a decorative span) presents exactly
    // this: the pressed element is not itself a node. The hit-test must walk up to
    // the nearest handle, which is what `closest` — not `event.target` — does.
    const { project, boxId } = buildProject();
    const store = makeStore(project);
    const { doc } = mount(store);

    const inner = doc.createElement('span');
    handle(doc, boxId).appendChild(inner);
    press(inner);

    expect(store.getState().present.context.selection).toEqual([boxId]);
  });

  it('clears the selection when you press the bare page body', () => {
    const { project, headingId } = buildProject();
    const store = makeStore(project);
    const { doc } = mount(store);

    press(handle(doc, headingId));
    expect(store.getState().present.context.selection).toEqual([headingId]);

    press(doc.body);
    expect(store.getState().present.context.selection).toEqual([]);
  });

  it('replaces the selection on a plain press', () => {
    const { project, headingId, boxId } = buildProject();
    const store = makeStore(project);
    const { doc } = mount(store);

    press(handle(doc, headingId));
    press(handle(doc, boxId));

    expect(store.getState().present.context.selection).toEqual([boxId]);
  });

  it('extends the selection on shift-press', () => {
    const { project, headingId, boxId } = buildProject();
    const store = makeStore(project);
    const { doc } = mount(store);

    press(handle(doc, headingId));
    press(handle(doc, boxId), { shiftKey: true });

    expect(store.getState().present.context.selection).toEqual([headingId, boxId]);
  });
});

describe('the selection overlay', () => {
  it('draws a box over the selected node', () => {
    const { project, headingId } = buildProject();
    const store = makeStore(project);
    const { container, doc } = mount(store);

    press(handle(doc, headingId));

    // The overlay lives in the editor document, not the frame, and tags each box
    // with its node id.
    expect(container.querySelector(`[data-vpb-selection="${headingId}"]`)).not.toBeNull();
  });

  it('draws a box for every selected node, not just the first', () => {
    const { project, headingId, boxId } = buildProject();
    const store = makeStore(project);
    const { container, doc } = mount(store);

    press(handle(doc, headingId));
    press(handle(doc, boxId), { shiftKey: true });

    expect(container.querySelectorAll('[data-vpb-selection]')).toHaveLength(2);
  });

  it('shows nothing when nothing is selected', () => {
    const { project } = buildProject();
    const store = makeStore(project);
    const { container } = mount(store);

    expect(container.querySelectorAll('[data-vpb-selection]')).toHaveLength(0);
  });
});
