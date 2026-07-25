import {
  BOX_COMPONENT_ID,
  SECTION_COMPONENT_ID,
  childrenOf,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createNode,
  createPage,
  getComponent,
  insertNode,
  moveNode,
  unsafeId,
  type ComponentId,
  type IdFactory,
  type Node,
  type NodeId,
  type NodeTree,
} from '@vpb/core';
import { describe, expect, it } from 'vitest';

import { dropTarget, type DropChild, type Rect } from '../dropTarget.ts';

/**
 * The geometry is pure, so these tests are arithmetic — no DOM, no jsdom. The last
 * block closes the loop against core: the index this returns is fed to the real
 * `moveNode`, and the resulting child order is asserted. That is the contract that
 * actually matters, and the one an off-by-one hides in.
 */

/** A vertical child rectangle: `top..top+height`, so its midpoint is `top + height/2`. */
function vrect(top: number, height = 20): Rect {
  return { left: 0, top, width: 100, height };
}

function child(id: string, rect: Rect): DropChild {
  return { id: unsafeId<NodeId>(id), rect };
}

describe('dropTarget — vertical', () => {
  const zone = (children: readonly DropChild[]) =>
    ({ parentId: unsafeId<NodeId>('parent'), children, axis: 'vertical' }) as const;

  it('prepends when the pointer is above every child', () => {
    const drop = dropTarget({ x: 0, y: 5 }, zone([child('a', vrect(10)), child('b', vrect(40))]));
    expect(drop.index).toBe(0);
  });

  it('appends when the pointer is below every midpoint', () => {
    const drop = dropTarget({ x: 0, y: 100 }, zone([child('a', vrect(10)), child('b', vrect(40))]));
    expect(drop.index).toBe(2);
  });

  it('lands in the gap the pointer is over', () => {
    // Midpoints: a=20, b=60, c=100. Pointer at 70 is past a and b, before c.
    const drop = dropTarget(
      { x: 0, y: 70 },
      zone([child('a', vrect(10)), child('b', vrect(50)), child('c', vrect(90))]),
    );
    expect(drop.index).toBe(2);
  });

  it('flips at the MIDPOINT, not an edge', () => {
    // One child spanning 0..100, midpoint 50.
    const one = zone([child('a', vrect(0, 100))]);
    expect(dropTarget({ x: 0, y: 40 }, one).index).toBe(0); // above midpoint -> before
    expect(dropTarget({ x: 0, y: 60 }, one).index).toBe(1); // below midpoint -> after
  });

  it('ignores the pointer x on a vertical axis', () => {
    const z = zone([child('a', vrect(10)), child('b', vrect(40))]);
    expect(dropTarget({ x: 0, y: 45 }, z).index).toBe(dropTarget({ x: 9999, y: 45 }, z).index);
  });

  it('drops at 0 in an empty container', () => {
    expect(dropTarget({ x: 0, y: 50 }, zone([])).index).toBe(0);
  });

  it('carries the zone parent through', () => {
    expect(dropTarget({ x: 0, y: 50 }, zone([])).parentId).toBe(unsafeId<NodeId>('parent'));
  });
});

describe('dropTarget — horizontal', () => {
  const hrect = (left: number, width = 20): Rect => ({ left, top: 0, width, height: 100 });
  const zone = (children: readonly DropChild[]) =>
    ({ parentId: unsafeId<NodeId>('row'), children, axis: 'horizontal' }) as const;

  it('measures along x', () => {
    // Midpoints: a=10, b=50. Pointer x=30 is past a, before b.
    const drop = dropTarget({ x: 30, y: 0 }, zone([child('a', hrect(0)), child('b', hrect(40))]));
    expect(drop.index).toBe(1);
  });

  it('ignores the pointer y on a horizontal axis', () => {
    const z = zone([child('a', hrect(0)), child('b', hrect(40))]);
    expect(dropTarget({ x: 30, y: 0 }, z).index).toBe(dropTarget({ x: 30, y: 9999 }, z).index);
  });
});

/* -------------------------------------------------------------------------- */
/* The index composes with core's moveNode — the contract that must hold       */
/* -------------------------------------------------------------------------- */

const registry = createBuiltinRegistry();

function make(ids: IdFactory, component: ComponentId): Node {
  const definition = getComponent(registry, component);
  if (!definition) throw new Error(`registry is missing ${component}`);
  return createNode(definition, ids);
}

/** body > section > [a, b, c], with rects stacked 20px apart (midpoints 10/30/50). */
function threeInARow() {
  const ids = createDeterministicIdFactory();
  const page = createPage('Home', '/', ids);
  const section = make(ids, SECTION_COMPONENT_ID);
  const a = make(ids, BOX_COMPONENT_ID);
  const b = make(ids, BOX_COMPONENT_ID);
  const c = make(ids, BOX_COMPONENT_ID);

  let tree = page.tree;
  tree = insertNode(tree, section, tree.root);
  tree = insertNode(tree, a, section.id);
  tree = insertNode(tree, b, section.id);
  tree = insertNode(tree, c, section.id);

  const children: DropChild[] = [
    { id: a.id, rect: vrect(0) },
    { id: b.id, rect: vrect(20) },
    { id: c.id, rect: vrect(40) },
  ];
  return { tree, section: section.id, a: a.id, b: b.id, c: c.id, children };
}

function order(tree: NodeTree, parent: NodeId): readonly NodeId[] {
  return childrenOf(tree, parent).map((node) => node.id);
}

describe('the index composes with moveNode', () => {
  it('reorders a same-parent move to the gap the pointer names', () => {
    // The dragged node is INCLUDED in the children, and moveNode does the
    // same-parent decrement — so dropping A into the B|C gap must yield [B, A, C],
    // not [B, C, A]. This is the off-by-one AUDIT §4.4-era code got wrong.
    const { tree, section, a, b, c, children } = threeInARow();
    const zone = { parentId: section, children, axis: 'vertical' as const };

    // Pointer at y=45: past midpoints 10 and 30, before 50.
    const drop = dropTarget({ x: 0, y: 45 }, zone);
    expect(drop.index).toBe(2);

    const moved = moveNode(tree, a, drop.parentId, drop.index);
    expect(order(moved, section)).toEqual([b, a, c]);
  });

  it('appends a same-parent move dropped past the last midpoint', () => {
    const { tree, section, a, b, c, children } = threeInARow();
    const zone = { parentId: section, children, axis: 'vertical' as const };

    const drop = dropTarget({ x: 0, y: 100 }, zone);
    const moved = moveNode(tree, a, drop.parentId, drop.index);
    expect(order(moved, section)).toEqual([b, c, a]);
  });

  it('inserts a cross-parent move at the pointer gap without a decrement', () => {
    // Dragging into a DIFFERENT parent: the node is not among that parent's
    // children, so no decrement applies and the raw index is the insertion point.
    const ids = createDeterministicIdFactory();
    const page = createPage('Home', '/', ids);
    const from = make(ids, SECTION_COMPONENT_ID);
    const into = make(ids, SECTION_COMPONENT_ID);
    const dragged = make(ids, BOX_COMPONENT_ID);
    const x = make(ids, BOX_COMPONENT_ID);
    const y = make(ids, BOX_COMPONENT_ID);

    let tree = page.tree;
    tree = insertNode(tree, from, tree.root);
    tree = insertNode(tree, into, tree.root);
    tree = insertNode(tree, dragged, from.id);
    tree = insertNode(tree, x, into.id);
    tree = insertNode(tree, y, into.id);

    // `into` has [x(mid 10), y(mid 30)]; pointer at 20 lands between them.
    const zone = {
      parentId: into.id,
      children: [
        { id: x.id, rect: vrect(0) },
        { id: y.id, rect: vrect(20) },
      ],
      axis: 'vertical' as const,
    };
    const drop = dropTarget({ x: 0, y: 20 }, zone);
    expect(drop.index).toBe(1);

    const moved = moveNode(tree, dragged.id, drop.parentId, drop.index);
    expect(order(moved, into.id)).toEqual([x.id, dragged.id, y.id]);
  });
});
