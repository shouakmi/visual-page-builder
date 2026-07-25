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
} from '@vpb/core';
import { afterEach, describe, expect, it } from 'vitest';

import { snapTargets } from '../snapTargets.ts';

/**
 * `snapTargets` reads layout jsdom does not compute, so the reads are STUBBED to
 * known rects and the candidate lines it derives are asserted — the same treatment
 * `resolveDrop.test.ts` gives the drag adapter, for the same reason.
 *
 * The rects are chosen so every line is traceable to exactly one source: no two
 * elements share a width, a height, or an edge that matters below. That is what
 * lets "this line is absent" be a real assertion rather than a coincidence.
 */

const registry = createBuiltinRegistry();

function make(ids: IdFactory, component: ComponentId): Node {
  const definition = getComponent(registry, component);
  if (!definition) throw new Error(`registry is missing ${component}`);
  return createNode(definition, ids);
}

/** body > [section1 > [t1, t2, t3], section2]. */
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

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function place(id: NodeId, box: DOMRect): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('data-vpb-node-id', id);
  element.getBoundingClientRect = () => box;
  document.body.appendChild(element);
  return element;
}

/** The page root renders as the frame body, so the body's own rect is a candidate source. */
function placeBody(box: DOMRect) {
  document.body.getBoundingClientRect = () => box;
}

afterEach(() => {
  document.body.innerHTML = '';
  Reflect.deleteProperty(document.body, 'getBoundingClientRect');
});

/**
 * The standard scene. t2 is the node being resized; its siblings t1 and t3 and
 * their container section1 are what it may align to.
 *
 *   t1        (0,  0) 100 x 20   ->  x 0/50/100    y 0/10/20
 *   t2        (0, 30)  84 x 20   ->  the resized box: own lines x 42/84, y 40/50
 *   t3        (0, 60)  60 x 20   ->  x 0/30/60     y 60/70/80
 *   section1  (0,  0) 200 x 300  ->  x 0/100/200   y 0/150/300
 */
function scene() {
  const built = buildTree();
  place(built.t1, rect(0, 0, 100, 20));
  place(built.t2, rect(0, 30, 84, 20));
  place(built.t3, rect(0, 60, 60, 20));
  place(built.section1, rect(0, 0, 200, 300));
  return built;
}

function positions(input: ReturnType<typeof snapTargets>, axis: 'x' | 'y'): readonly number[] {
  return (input?.candidates ?? []).filter((c) => c.axis === axis).map((c) => c.position);
}

describe('what a resized box may align to', () => {
  it('reports the box origin from the resized element, for the geometry to measure against', () => {
    const { tree, t2 } = scene();

    const input = snapTargets({ doc: document, tree, nodeId: t2 });

    expect(input?.boxOrigin).toEqual({ x: 0, y: 30 });
  });

  it('offers the siblings lines', () => {
    const { tree, t2 } = scene();

    const input = snapTargets({ doc: document, tree, nodeId: t2 });

    // t1's midline and bottom, t3's midline and top.
    expect(positions(input, 'y')).toEqual(expect.arrayContaining([10, 20, 60, 70]));
    // t1's right edge and t3's right edge.
    expect(positions(input, 'x')).toEqual(expect.arrayContaining([100, 60]));
  });

  it('offers the container lines, because filling the parent is the commonest intent', () => {
    const { tree, t2 } = scene();

    const input = snapTargets({ doc: document, tree, nodeId: t2 });

    // section1: right edge 200, midline 100 on x; bottom 300, midline 150 on y.
    expect(positions(input, 'x')).toEqual(expect.arrayContaining([200, 100]));
    expect(positions(input, 'y')).toEqual(expect.arrayContaining([300, 150]));
  });

  it('never offers the resized box its own edges — it could never leave them', () => {
    const { tree, t2 } = scene();

    const input = snapTargets({ doc: document, tree, nodeId: t2 });

    // t2 is 84 wide at x=0 and 20 tall at y=30: its own right edge, midline and
    // bottom. A zero-distance candidate captures on every move and freezes the box.
    expect(positions(input, 'x')).not.toContain(84);
    expect(positions(input, 'x')).not.toContain(42);
    expect(positions(input, 'y')).not.toContain(50);
    expect(positions(input, 'y')).not.toContain(40);
  });

  it('does not offer its own descendants, which move as it resizes', () => {
    const { tree, section1 } = scene();
    placeBody(rect(0, 0, 400, 800));

    const input = snapTargets({ doc: document, tree, nodeId: section1 });

    // t1/t2/t3 live INSIDE section1. Snapping a container to its own child is a
    // feedback loop: the child moves because the container resized.
    expect(positions(input, 'y')).not.toContain(10); // t1's midline
    expect(positions(input, 'y')).not.toContain(70); // t3's midline
  });

  it('falls back to the frame body as the container for a top-level node', () => {
    const { tree, section1 } = scene();
    placeBody(rect(0, 0, 400, 800));

    const input = snapTargets({ doc: document, tree, nodeId: section1 });

    // The page root renders no element of its own, so the body IS the container.
    expect(positions(input, 'x')).toEqual(expect.arrayContaining([400, 200]));
    expect(positions(input, 'y')).toEqual(expect.arrayContaining([800]));
  });

  it('skips a sibling that has no element on the page', () => {
    const built = buildTree();
    place(built.t2, rect(0, 30, 84, 20));
    place(built.t1, rect(0, 0, 100, 20));
    place(built.section1, rect(0, 0, 200, 300));
    // t3 is in the tree but never placed — a hidden node, or one mid-render.

    const input = snapTargets({ doc: document, tree: built.tree, nodeId: built.t3 });
    const forT2 = snapTargets({ doc: document, tree: built.tree, nodeId: built.t2 });

    // Nothing to measure the missing node itself against...
    expect(input).toBeNull();
    // ...and it contributes no lines to anyone else, without throwing.
    expect(positions(forT2, 'y')).not.toContain(70);
  });

  it('reports nothing when the resized node is not on the page', () => {
    const { tree, t2 } = buildTree();

    expect(snapTargets({ doc: document, tree, nodeId: t2 })).toBeNull();
  });
});
