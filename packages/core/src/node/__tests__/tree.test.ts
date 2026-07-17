import { beforeEach, describe, expect, it } from 'vitest';

import { createDeterministicIdFactory, type IdFactory } from '../../identity/idFactory.ts';
import type { NodeId } from '../../identity/ids.ts';
import { unsafeId } from '../../identity/ids.ts';
import {
  bodyComponent,
  boxComponent,
  createBuiltinRegistry,
  headingComponent,
  imageComponent,
  sectionComponent,
} from '../builtins.ts';
import type { ComponentDefinition } from '../component.ts';
import { createRegistry } from '../component.ts';
import type { Node } from '../node.ts';
import { addClass, createNode, setHidden } from '../node.ts';
import { propAsset } from '../props.ts';
import type { NodeTree } from '../tree.ts';
import {
  ancestorIds,
  canDropNode,
  canInsertComponent,
  canMoveNode,
  childIdsOf,
  createTree,
  depthOf,
  descendantIds,
  duplicateNode,
  findNodes,
  getNode,
  insertNode,
  insertSubtree,
  isAncestor,
  moveNode,
  nodeCount,
  nodePath,
  nodesWithClass,
  parentIdOf,
  removeNode,
  rootNode,
  siblingIndex,
  subtreeIds,
  treeAssets,
  unknownComponentNodes,
  updateNode,
  updateNodeBy,
  validateTree,
  walk,
} from '../tree.ts';

const A = (v: string) => unsafeId<NodeId>(v);

let ids: IdFactory;
beforeEach(() => {
  ids = createDeterministicIdFactory();
});

/**
 * The parent index is derived state maintained incrementally, and derived state
 * maintained incrementally drifts. Asserting it after EVERY mutation means an
 * index bug surfaces at the operation that caused it, not three phases later as a
 * layer panel that recurses forever.
 */
const expectConsistent = (tree: NodeTree) => {
  expect(validateTree(tree)).toEqual([]);
};

const body = () => createNode(bodyComponent, ids);
const box = () => createNode(boxComponent, ids);

/** body > [a, b, c] */
const flat = () => {
  const root = body();
  let tree = createTree(root);
  const a = box();
  const b = box();
  const c = box();
  tree = insertNode(tree, a, root.id);
  tree = insertNode(tree, b, root.id);
  tree = insertNode(tree, c, root.id);
  return { tree, root, a, b, c };
};

/** body > outer > inner > leaf */
const nested = () => {
  const root = body();
  let tree = createTree(root);
  const outer = box();
  const inner = box();
  const leaf = box();
  tree = insertNode(tree, outer, root.id);
  tree = insertNode(tree, inner, outer.id);
  tree = insertNode(tree, leaf, inner.id);
  return { tree, root, outer, inner, leaf };
};

describe('createTree', () => {
  it('starts with only the root', () => {
    const root = body();
    const tree = createTree(root);

    expect(nodeCount(tree)).toBe(1);
    expect(rootNode(tree)).toEqual(root);
    expect(parentIdOf(tree, root.id)).toBeUndefined();
    expectConsistent(tree);
  });

  it('throws rather than inventing a root when the store is corrupt', () => {
    const tree: NodeTree = { root: A('ghost'), nodes: new Map(), parents: new Map() };
    expect(() => rootNode(tree)).toThrow(/missing/i);
  });
});

describe('insertNode', () => {
  it('appends when no index is given', () => {
    const { tree, root, a, b, c } = flat();
    expect(childIdsOf(tree, root.id)).toEqual([a.id, b.id, c.id]);
    expectConsistent(tree);
  });

  /**
   * The prototype's insert could ONLY append (AUDIT §4.4) — which is precisely
   * why it had no insert-before, no insert-after, and no drop position.
   */
  it('inserts at an index', () => {
    const { tree, root, a, b, c } = flat();
    const inserted = box();
    const next = insertNode(tree, inserted, root.id, 1);

    expect(childIdsOf(next, root.id)).toEqual([a.id, inserted.id, b.id, c.id]);
    expectConsistent(next);
  });

  it('inserts at the front', () => {
    const { tree, root, a } = flat();
    const inserted = box();
    const next = insertNode(tree, inserted, root.id, 0);

    expect(childIdsOf(next, root.id)[0]).toBe(inserted.id);
    expect(childIdsOf(next, root.id)[1]).toBe(a.id);
    expectConsistent(next);
  });

  it('clamps an out-of-range index instead of losing the drop', () => {
    const { tree, root, a, b, c } = flat();
    const past = box();
    const before = box();
    const high = insertNode(tree, past, root.id, 99);
    const low = insertNode(tree, before, root.id, -5);

    expect(childIdsOf(high, root.id)).toEqual([a.id, b.id, c.id, past.id]);
    expect(childIdsOf(low, root.id)).toEqual([before.id, a.id, b.id, c.id]);
    expectConsistent(high);
    expectConsistent(low);
  });

  it('maintains the parent index', () => {
    const { tree, root, b } = flat();
    expect(parentIdOf(tree, b.id)).toBe(root.id);
  });

  it('ignores an unknown parent', () => {
    const { tree } = flat();
    expect(insertNode(tree, box(), A('nope'))).toBe(tree);
  });

  it('ignores a node that is already in the tree', () => {
    const { tree, a, root } = flat();
    expect(insertNode(tree, a, root.id)).toBe(tree);
  });

  /**
   * A node carrying children whose ids are not in `nodes` would validate as fine
   * and render nothing. `insertSubtree` is the supported path.
   */
  it('refuses a node that arrives with children', () => {
    const { tree, root, a } = flat();
    const smuggler = { ...box(), children: [a.id] };
    expect(insertNode(tree, smuggler, root.id)).toBe(tree);
  });
});

describe('insertSubtree', () => {
  const detached = (): { nodes: Node[]; rootId: NodeId } => {
    const parent = box();
    const child = box();
    return {
      nodes: [{ ...parent, children: [child.id] }, child],
      rootId: parent.id,
    };
  };

  it('inserts a whole subtree and indexes every node', () => {
    const { tree, root } = flat();
    const { nodes, rootId } = detached();
    const next = insertSubtree(tree, nodes, rootId, root.id, 0);

    expect(nodeCount(next)).toBe(nodeCount(tree) + 2);
    expect(childIdsOf(next, root.id)[0]).toBe(rootId);
    expect(parentIdOf(next, childIdsOf(next, rootId)[0] as NodeId)).toBe(rootId);
    expectConsistent(next);
  });

  it('rejects a subtree referencing a child it does not carry', () => {
    const { tree, root } = flat();
    const parent = box();
    const orphanRef = { ...parent, children: [A('missing')] };
    expect(insertSubtree(tree, [orphanRef], parent.id, root.id)).toBe(tree);
  });

  it('rejects a subtree carrying a detached fragment', () => {
    const { tree, root } = flat();
    const { nodes, rootId } = detached();
    const stowaway = box();
    expect(insertSubtree(tree, [...nodes, stowaway], rootId, root.id)).toBe(tree);
  });

  it('rejects a subtree whose id already exists', () => {
    const { tree, root, a } = flat();
    expect(insertSubtree(tree, [a], a.id, root.id)).toBe(tree);
  });
});

describe('updateNode', () => {
  it('replaces a node in place', () => {
    const { tree, a } = flat();
    const next = updateNode(tree, addClass(a, unsafeId('btn')));

    expect(getNode(next, a.id)?.classes).toEqual(['btn']);
    expect(siblingIndex(next, a.id)).toBe(0);
    expectConsistent(next);
  });

  /**
   * Structure only ever changes through insert/move/remove, which maintain the
   * parent index. An updateNode that honoured a caller's `children` would change
   * structure without touching `parents` and corrupt the tree silently.
   */
  it('ignores a caller-supplied children array', () => {
    const { tree, root, a } = nestedRootWithChild();
    const next = updateNode(tree, { ...(getNode(tree, root.id) as Node), children: [] });

    expect(childIdsOf(next, root.id)).toEqual([a.id]);
    expectConsistent(next);
  });

  it('ignores an unknown node', () => {
    const { tree } = flat();
    expect(updateNode(tree, box())).toBe(tree);
  });

  it('updateNodeBy passes the current node', () => {
    const { tree, a } = flat();
    const next = updateNodeBy(tree, a.id, (node) => setHidden(node, true));
    expect(getNode(next, a.id)?.hidden).toBe(true);
    expectConsistent(next);
  });
});

function nestedRootWithChild() {
  const root = body();
  const a = box();
  const tree = insertNode(createTree(root), a, root.id);
  return { tree, root, a };
}

describe('reading', () => {
  it('walks in document order', () => {
    const { tree, root, outer, inner, leaf } = nested();
    expect(walk(tree).map((n) => n.id)).toEqual([root.id, outer.id, inner.id, leaf.id]);
  });

  it('walks siblings left to right', () => {
    const { tree, root, a, b, c } = flat();
    expect(subtreeIds(tree, root.id)).toEqual([root.id, a.id, b.id, c.id]);
  });

  it('reports ancestors root-first', () => {
    const { tree, root, outer, inner, leaf } = nested();
    expect(ancestorIds(tree, leaf.id)).toEqual([root.id, outer.id, inner.id]);
    expect(ancestorIds(tree, root.id)).toEqual([]);
  });

  it('reports the inclusive path', () => {
    const { tree, root, outer, inner, leaf } = nested();
    expect(nodePath(tree, leaf.id)).toEqual([root.id, outer.id, inner.id, leaf.id]);
    expect(nodePath(tree, A('nope'))).toEqual([]);
  });

  it('reports depth', () => {
    const { tree, root, leaf } = nested();
    expect(depthOf(tree, root.id)).toBe(0);
    expect(depthOf(tree, leaf.id)).toBe(3);
  });

  it('isAncestor is inclusive and directional', () => {
    const { tree, root, outer, leaf } = nested();
    expect(isAncestor(tree, root.id, leaf.id)).toBe(true);
    expect(isAncestor(tree, outer.id, leaf.id)).toBe(true);
    expect(isAncestor(tree, leaf.id, leaf.id)).toBe(true);
    expect(isAncestor(tree, leaf.id, outer.id)).toBe(false);
  });

  it('reports descendants without the node itself', () => {
    const { tree, outer, inner, leaf } = nested();
    expect(descendantIds(tree, outer.id)).toEqual([inner.id, leaf.id]);
  });

  it('reports sibling index, and -1 for the root', () => {
    const { tree, root, b } = flat();
    expect(siblingIndex(tree, b.id)).toBe(1);
    expect(siblingIndex(tree, root.id)).toBe(-1);
  });

  it('finds nodes by class', () => {
    const { tree, a, b } = flat();
    let next = updateNode(tree, addClass(a, unsafeId('btn')));
    next = updateNode(next, addClass(b, unsafeId('btn')));

    expect(nodesWithClass(next, unsafeId('btn')).map((n) => n.id)).toEqual([a.id, b.id]);
    expect(nodesWithClass(next, unsafeId('nope'))).toEqual([]);
  });

  it('finds nodes by predicate', () => {
    const { tree, a } = flat();
    const next = updateNode(tree, setHidden(a, true));
    expect(findNodes(next, (n) => n.hidden === true).map((n) => n.id)).toEqual([a.id]);
  });

  /** Only possible because an asset prop is a distinct kind, not a string. */
  it('collects assets across the tree, deduplicated', () => {
    const { tree, root } = flat();
    const image = createNode(imageComponent, ids, { props: { src: propAsset(unsafeId('hero')) } });
    const other = createNode(imageComponent, ids, { props: { src: propAsset(unsafeId('hero')) } });
    let next = insertNode(tree, image, root.id);
    next = insertNode(next, other, root.id);

    expect(treeAssets(next)).toEqual(['hero']);
  });
});

describe('removeNode', () => {
  it('removes the node and its whole subtree', () => {
    const { tree, outer, inner, leaf } = nested();
    const { tree: next, removed } = removeNode(tree, outer.id);

    expect(nodeCount(next)).toBe(1);
    expect(getNode(next, inner.id)).toBeUndefined();
    expect([...removed]).toEqual([outer.id, inner.id, leaf.id]);
    expectConsistent(next);
  });

  /**
   * The returned ids are how the caller GCs node-scoped style rules. Without them
   * every delete leaks rules into the exported CSS forever.
   */
  it('returns every removed id so the caller can sweep style rules', () => {
    const { tree, outer } = nested();
    const { removed } = removeNode(tree, outer.id);
    expect(removed).toHaveLength(3);
  });

  it('detaches from the parent', () => {
    const { tree, root, a, b, c } = flat();
    const { tree: next } = removeNode(tree, b.id);

    expect(childIdsOf(next, root.id)).toEqual([a.id, c.id]);
    expect(parentIdOf(next, b.id)).toBeUndefined();
    expectConsistent(next);
  });

  it('refuses to remove the root', () => {
    const { tree, root } = flat();
    const { tree: next, removed } = removeNode(tree, root.id);

    expect(next).toBe(tree);
    expect(removed).toEqual([]);
  });

  it('ignores an unknown node', () => {
    const { tree } = flat();
    expect(removeNode(tree, A('nope')).tree).toBe(tree);
  });
});

describe('moveNode', () => {
  it('reparents', () => {
    const { tree, root, outer, leaf } = nested();
    const next = moveNode(tree, leaf.id, root.id);

    expect(parentIdOf(next, leaf.id)).toBe(root.id);
    expect(childIdsOf(next, root.id)).toEqual([outer.id, leaf.id]);
    expectConsistent(next);
  });

  it('reparents to an index', () => {
    const { tree, root, outer, leaf } = nested();
    const next = moveNode(tree, leaf.id, root.id, 0);
    expect(childIdsOf(next, root.id)).toEqual([leaf.id, outer.id]);
    expectConsistent(next);
  });

  /**
   * THE OFF-BY-ONE. `index` is a position in the children array AS THE USER SEES
   * IT, before the move. Dragging item 0 into the gap after item 2 is index 3;
   * removing item 0 first shifts everything down, so a naive re-insert at 3 lands
   * it at the end. Users reproduce this on their first drag.
   */
  it('moves later within the same parent using pre-move indices', () => {
    const { tree, root, a, b, c } = flat();
    const next = moveNode(tree, a.id, root.id, 3);

    expect(childIdsOf(next, root.id)).toEqual([b.id, c.id, a.id]);
    expectConsistent(next);
  });

  it('moves one slot later within the same parent', () => {
    const { tree, root, a, b, c } = flat();
    const next = moveNode(tree, a.id, root.id, 2);

    expect(childIdsOf(next, root.id)).toEqual([b.id, a.id, c.id]);
    expectConsistent(next);
  });

  it('moves earlier within the same parent without adjustment', () => {
    const { tree, root, a, b, c } = flat();
    const next = moveNode(tree, c.id, root.id, 0);

    expect(childIdsOf(next, root.id)).toEqual([c.id, a.id, b.id]);
    expectConsistent(next);
  });

  it('moving to its own index is a no-op in effect', () => {
    const { tree, root, a, b, c } = flat();
    const next = moveNode(tree, b.id, root.id, 1);

    expect(childIdsOf(next, root.id)).toEqual([a.id, b.id, c.id]);
    expectConsistent(next);
  });

  it('appends when no index is given', () => {
    const { tree, root, a, b, c } = flat();
    const next = moveNode(tree, a.id, root.id);

    expect(childIdsOf(next, root.id)).toEqual([b.id, c.id, a.id]);
    expectConsistent(next);
  });

  it('carries its subtree along', () => {
    const { tree, root, outer, inner, leaf } = nested();
    const next = moveNode(tree, inner.id, root.id);

    expect(parentIdOf(next, inner.id)).toBe(root.id);
    expect(parentIdOf(next, leaf.id)).toBe(inner.id);
    expect(childIdsOf(next, outer.id)).toEqual([]);
    expect(nodeCount(next)).toBe(4);
    expectConsistent(next);
  });

  /**
   * THE CYCLE GUARD. Dropping a node into its own descendant detaches the branch
   * into a ring: the layer panel recurses forever and the user's page is gone.
   */
  it('refuses to move a node into its own descendant', () => {
    const { tree, outer, leaf } = nested();
    expect(canMoveNode(tree, outer.id, leaf.id)).toBe(false);
    expect(moveNode(tree, outer.id, leaf.id)).toBe(tree);
    expectConsistent(moveNode(tree, outer.id, leaf.id));
  });

  it('refuses to move a node into itself', () => {
    const { tree, outer } = nested();
    expect(canMoveNode(tree, outer.id, outer.id)).toBe(false);
    expect(moveNode(tree, outer.id, outer.id)).toBe(tree);
  });

  it('refuses to move the root', () => {
    const { tree, root, outer } = nested();
    expect(canMoveNode(tree, root.id, outer.id)).toBe(false);
    expect(moveNode(tree, root.id, outer.id)).toBe(tree);
  });

  it('ignores unknown nodes', () => {
    const { tree, root } = flat();
    expect(moveNode(tree, A('nope'), root.id)).toBe(tree);
    expect(moveNode(tree, root.id, A('nope'))).toBe(tree);
  });

  it('allows a move between siblings that are not related', () => {
    const { tree, a, b } = flat();
    expect(canMoveNode(tree, a.id, b.id)).toBe(true);
    const next = moveNode(tree, a.id, b.id);

    expect(parentIdOf(next, a.id)).toBe(b.id);
    expectConsistent(next);
  });
});

describe('duplicateNode', () => {
  it('inserts the copy directly after the original', () => {
    const { tree, root, a, b, c } = flat();
    const { tree: next, newId } = duplicateNode(tree, a.id, ids);

    expect(childIdsOf(next, root.id)).toEqual([a.id, newId, b.id, c.id]);
    expectConsistent(next);
  });

  it('deep-copies the subtree with fresh ids', () => {
    const { tree, outer, inner, leaf } = nested();
    const { tree: next, newId, idMap } = duplicateNode(tree, outer.id, ids);

    expect(nodeCount(next)).toBe(7);
    expect(newId).not.toBe(outer.id);
    expect(idMap.get(inner.id)).toBeDefined();
    expect(idMap.get(leaf.id)).toBeDefined();
    expect(descendantIds(next, newId as NodeId)).toHaveLength(2);
    expectConsistent(next);
  });

  it('copies props and classes but not identity', () => {
    const { tree, root } = flat();
    const image = createNode(imageComponent, ids, { props: { src: propAsset(unsafeId('hero')) } });
    const withImage = insertNode(tree, addClass(image, unsafeId('card')), root.id);
    const { tree: next, newId } = duplicateNode(withImage, image.id, ids);

    const copy = getNode(next, newId as NodeId);
    expect(copy?.classes).toEqual(['card']);
    expect(copy?.props.src).toEqual(propAsset(unsafeId('hero')));
    expect(copy?.id).not.toBe(image.id);
    expectConsistent(next);
  });

  it('returns a map from old ids to new ids for the caller style copy', () => {
    const { tree, outer, inner, leaf } = nested();
    const { tree: next, idMap } = duplicateNode(tree, outer.id, ids);

    // Every node of the original subtree, mapped to a fresh id that is really in
    // the tree — this map is what Phase C uses to re-point node-scoped rules.
    expect([...idMap.keys()]).toEqual([outer.id, inner.id, leaf.id]);
    for (const [oldId, newId] of idMap) {
      expect(newId).not.toBe(oldId);
      expect(getNode(next, newId)).toBeDefined();
    }
  });

  it('refuses to duplicate the root, which has nowhere to go', () => {
    const { tree, root } = flat();
    const { tree: next, newId } = duplicateNode(tree, root.id, ids);

    expect(next).toBe(tree);
    expect(newId).toBeUndefined();
  });

  it('ignores an unknown node', () => {
    const { tree } = flat();
    expect(duplicateNode(tree, A('nope'), ids).tree).toBe(tree);
  });
});

describe('component rules', () => {
  const registry = createBuiltinRegistry();

  it('allows a box inside a section', () => {
    const { tree, root } = flat();
    const section = createNode(sectionComponent, ids);
    const next = insertNode(tree, section, root.id);

    expect(canInsertComponent(next, registry, section.id, boxComponent.id)).toBe(true);
  });

  /** The prototype's text node silently DROPPED children it was given. */
  it('refuses any child inside a text-only component', () => {
    const { tree, root } = flat();
    const heading = createNode(headingComponent, ids);
    const next = insertNode(tree, heading, root.id);

    expect(canInsertComponent(next, registry, heading.id, boxComponent.id)).toBe(false);
  });

  it('refuses any child inside a void component', () => {
    const { tree, root } = flat();
    const image = createNode(imageComponent, ids);
    const next = insertNode(tree, image, root.id);

    expect(canInsertComponent(next, registry, image.id, boxComponent.id)).toBe(false);
  });

  it('honours allowedChildren and allowedParents', () => {
    const tabs: ComponentDefinition = {
      id: unsafeId('test:tabs'),
      label: 'Tabs',
      category: 'interactive',
      tag: 'div',
      children: 'flow',
      props: [],
      allowedChildren: [unsafeId('test:tab')],
    };
    const tab: ComponentDefinition = {
      id: unsafeId('test:tab'),
      label: 'Tab',
      category: 'interactive',
      tag: 'div',
      children: 'flow',
      props: [],
      allowedParents: [unsafeId('test:tabs')],
    };
    const custom = createRegistry([bodyComponent, boxComponent, tabs, tab]);

    const root = body();
    let tree = createTree(root);
    const tabsNode = createNode(tabs, ids);
    tree = insertNode(tree, tabsNode, root.id);

    expect(canInsertComponent(tree, custom, tabsNode.id, tab.id)).toBe(true);
    expect(canInsertComponent(tree, custom, tabsNode.id, boxComponent.id)).toBe(false);
    // allowedParents blocks the reverse direction independently.
    expect(canInsertComponent(tree, custom, root.id, tab.id)).toBe(false);
  });

  it('canDropNode combines structure, locking, and component rules', () => {
    const { tree, root } = flat();
    const heading = createNode(headingComponent, ids);
    const dragged = box();
    let next = insertNode(tree, heading, root.id);
    next = insertNode(next, dragged, root.id);

    expect(canDropNode(next, registry, dragged.id, root.id)).toBe(true);
    expect(canDropNode(next, registry, dragged.id, heading.id)).toBe(false);

    const locked = updateNodeBy(next, dragged.id, (n) => ({ ...n, locked: true }));
    expect(canDropNode(locked, registry, dragged.id, root.id)).toBe(false);
  });

  /**
   * A project may be opened without the plugin that defined its components. Those
   * nodes must survive — deleting them would destroy the user's work because a
   * plugin failed to load.
   */
  it('reports nodes whose component is not registered without deleting them', () => {
    const { tree, root } = flat();
    const exotic: Node = { ...box(), component: unsafeId('acme:carousel') };
    const next = insertNode(tree, exotic, root.id);
    const bare = createRegistry([bodyComponent, boxComponent]);

    expect(unknownComponentNodes(next, bare).map((n) => n.id)).toEqual([exotic.id]);
    expect(getNode(next, exotic.id)).toBeDefined();
    expectConsistent(next);
  });
});

describe('validateTree', () => {
  it('accepts a healthy tree', () => {
    expect(validateTree(nested().tree)).toEqual([]);
  });

  it('catches a child whose parent is misrecorded', () => {
    const { tree, a, b } = flat();
    const parents = new Map(tree.parents);
    parents.set(a.id, b.id);

    expect(validateTree({ ...tree, parents }).join(' ')).toMatch(/parent/i);
  });

  it('catches a missing child', () => {
    const { tree, root } = flat();
    const nodes = new Map(tree.nodes);
    nodes.set(root.id, { ...(nodes.get(root.id) as Node), children: [A('ghost')] });

    expect(validateTree({ ...tree, nodes }).join(' ')).toMatch(/missing child/i);
  });

  it('catches an orphan', () => {
    const { tree } = flat();
    const nodes = new Map(tree.nodes);
    const stray = box();
    nodes.set(stray.id, stray);

    expect(validateTree({ ...tree, nodes }).join(' ')).toMatch(/not reachable/i);
  });

  /** Reachability is what catches a cycle: the ring detaches from the root. */
  it('catches a cycle', () => {
    const { tree, outer, leaf } = nested();
    const nodes = new Map(tree.nodes);
    const parents = new Map(tree.parents);
    // Hand-build what moveNode refuses to do: outer becomes a child of its own leaf.
    nodes.set(tree.root, { ...(nodes.get(tree.root) as Node), children: [] });
    nodes.set(leaf.id, { ...(nodes.get(leaf.id) as Node), children: [outer.id] });
    parents.set(outer.id, leaf.id);

    expect(validateTree({ ...tree, nodes, parents }).join(' ')).toMatch(/not reachable/i);
  });

  it('catches a duplicated child', () => {
    const { tree, root, a } = flat();
    const nodes = new Map(tree.nodes);
    const rootNodeValue = nodes.get(root.id) as Node;
    nodes.set(root.id, { ...rootNodeValue, children: [...rootNodeValue.children, a.id] });

    expect(validateTree({ ...tree, nodes }).join(' ')).toMatch(/twice/i);
  });

  it('catches a root with a parent', () => {
    const { tree, root, a } = flat();
    const parents = new Map(tree.parents);
    parents.set(root.id, a.id);

    expect(validateTree({ ...tree, parents }).join(' ')).toMatch(/root/i);
  });
});
