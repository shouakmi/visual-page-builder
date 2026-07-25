import {
  SECTION_COMPONENT_ID,
  TEXT_COMPONENT_ID,
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
  type Node,
  type NodeId,
  type NodeTree,
} from '@vpb/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveDrop } from '../resolveDrop.ts';

/**
 * `resolveDrop` reads layout it cannot compute — so here the reads are STUBBED to
 * known values and the drop it derives is asserted. This proves the adapter's logic
 * (which container, which gap, the validity guard, the axis) without a real browser;
 * only whether a genuinely laid-out page yields sensible rects is left to the manual
 * smoke test in HANDOFF.
 */

const registry = createBuiltinRegistry();

function make(ids: IdFactory, component: ComponentId): Node {
  const definition = getComponent(registry, component);
  if (!definition) throw new Error(`registry is missing ${component}`);
  return createNode(definition, ids);
}

/** body > [section1 > [t1, t2, t3 (text leaves)], section2 (empty container)]. */
function buildTree() {
  const ids = createDeterministicIdFactory();
  let project = createProject('Test', ids);
  const home = project.pages[0];
  if (!home) throw new Error('createProject always seeds a page');

  const section1 = make(ids, SECTION_COMPONENT_ID);
  const section2 = make(ids, SECTION_COMPONENT_ID);
  const t1 = make(ids, TEXT_COMPONENT_ID);
  const t2 = make(ids, TEXT_COMPONENT_ID);
  const t3 = make(ids, TEXT_COMPONENT_ID);

  let tree = home.tree;
  tree = insertNode(tree, section1, tree.root);
  tree = insertNode(tree, section2, tree.root);
  tree = insertNode(tree, t1, section1.id);
  tree = insertNode(tree, t2, section1.id);
  tree = insertNode(tree, t3, section1.id);
  project = updatePageBy(project, home.id, (page) => setPageTree(page, tree));

  return {
    tree: project.pages[0]!.tree,
    section1: section1.id,
    section2: section2.id,
    t1: t1.id,
    t2: t2.id,
    t3: t3.id,
  };
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

/** Put a stubbed element in the document for a node, so `querySelector` + rect reads find it. */
function place(id: NodeId, rect: DOMRect): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('data-vpb-node-id', id);
  element.getBoundingClientRect = () => rect;
  document.body.appendChild(element);
  return element;
}

/**
 * Point `elementFromPoint` at a chosen element and report a stack direction.
 *
 * `elementFromPoint` is DEFINED, not spied: jsdom does not implement it, so there
 * is nothing for `vi.spyOn` to wrap — the whole reason this file stubs the reads.
 */
function stubReads(target: Element | null, flexDirection = 'column') {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
  // `display: flex` so a `row` direction actually counts as horizontal — see axisOf.
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    display: 'flex',
    flexDirection,
  } as CSSStyleDeclaration);
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'elementFromPoint');
  document.body.innerHTML = '';
});

function args(tree: NodeTree, draggedId: NodeId, y: number) {
  return { doc: document, tree, registry, draggedId, pointer: { x: 0, y } };
}

describe('resolveDrop', () => {
  it('reorders among siblings when the pointer is over a leaf', () => {
    const { tree, section1, t1, t2, t3 } = buildTree();
    place(section1, vrect(0, 200)); // the container the children live in
    place(t1, vrect(0)); // midpoint 10
    const t2el = place(t2, vrect(20)); // midpoint 30
    place(t3, vrect(40)); // midpoint 50
    stubReads(t2el);

    // Dragging t1, hovering t2 at y=35 (past t1 and t2 midpoints, before t3).
    const drop = resolveDrop(args(tree, t1, 35));
    expect(drop).toEqual({ parentId: section1, index: 2 });
  });

  it('drops INTO an empty container the pointer is over', () => {
    const { tree, section2, t1 } = buildTree();
    const section2el = place(section2, vrect(200, 50));
    stubReads(section2el);

    // Dragging t1 (from section1) onto the empty section2.
    const drop = resolveDrop(args(tree, t1, 220));
    expect(drop).toEqual({ parentId: section2, index: 0 });
  });

  it('returns null over empty space with no handle', () => {
    const { tree, t1 } = buildTree();
    stubReads(null);
    expect(resolveDrop(args(tree, t1, 10))).toBeNull();
  });

  it('returns null when the drop would be invalid (into its own subtree)', () => {
    const { tree, section1, t1 } = buildTree();
    // Hover t1, which lives inside section1; dragging section1 there means moving
    // section1 into itself — core refuses, so the adapter reports no drop. The
    // parent element is placed too, so the ONLY thing that can return null here is
    // the validity guard — otherwise this would pass even with the guard removed.
    place(section1, vrect(0, 200));
    const t1el = place(t1, vrect(0));
    stubReads(t1el);
    expect(resolveDrop(args(tree, section1, 10))).toBeNull();
  });

  it('reads the stack axis from the container', () => {
    const { tree, section1, t1, t2, t3 } = buildTree();
    place(section1, hrect(0, 200)); // the row container
    place(t1, hrect(0)); // midpoint x=10
    const t2el = place(t2, hrect(20)); // midpoint x=30
    place(t3, hrect(40)); // midpoint x=50
    stubReads(t2el, 'row');

    // A row, so the index comes from x: pointer 35 is past 10 and 30, before 50.
    const drop = resolveDrop({
      doc: document,
      tree,
      registry,
      draggedId: t1,
      pointer: { x: 35, y: 0 },
    });
    expect(drop).toEqual({ parentId: section1, index: 2 });
  });
});

function hrect(left: number, width = 20): DOMRect {
  return {
    left,
    width,
    top: 0,
    height: 100,
    right: left + width,
    bottom: 100,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}
