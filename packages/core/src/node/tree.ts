import type { IdFactory } from '../identity/idFactory.ts';
import type { AssetId, ClassName, ComponentId, NodeId } from '../identity/ids.ts';
import type { ComponentRegistry } from './component.ts';
import { canContain, getComponent } from './component.ts';
import type { Node } from './node.ts';
import { referencedAssets } from './props.ts';

/**
 * THE NODE TREE.
 *
 * A flat store plus a derived parent index. Both halves are load-bearing, and
 * both are direct answers to AUDIT §4.4:
 *
 *  - `nodes` is `id -> Node`, so `getNode` is O(1). The prototype's `findNode` was
 *    an O(n) depth-first search called before nearly every operation.
 *
 *  - `parents` is `id -> parentId`. The prototype had no parent references, and
 *    the audit traces the consequence precisely: without them `insertNode` could
 *    only APPEND, so insert-before/after, reparenting, and drop indices were all
 *    impossible. "Phase 4: Drag & Drop Engine" shipped without drop or structural
 *    drag because the data model could not express either.
 *
 * Because children are ids, a node's subtree is not nested inside it. Editing a
 * node replaces one entry in a shallowly-copied Map — O(nodes) pointer copies,
 * microseconds — instead of deep-cloning the document per keystroke. The Map's
 * VALUES are shared by reference across versions, so this is already structural
 * sharing; the copy is of the pointer table alone.
 *
 * `parents` is derived, and derived state maintained incrementally drifts, so
 * every mutation below maintains it in the same breath as `children` and
 * `validateTree` exists to catch the day one of them forgets.
 */
export interface NodeTree {
  readonly root: NodeId;
  readonly nodes: ReadonlyMap<NodeId, Node>;
  /** Root is absent — it has no parent. */
  readonly parents: ReadonlyMap<NodeId, NodeId>;
}

export function createTree(root: Node): NodeTree {
  return { root: root.id, nodes: new Map([[root.id, root]]), parents: new Map() };
}

/* ---------------------------------------------------------------- reading */

export function getNode(tree: NodeTree, id: NodeId): Node | undefined {
  return tree.nodes.get(id);
}

export function hasNode(tree: NodeTree, id: NodeId): boolean {
  return tree.nodes.has(id);
}

export function nodeCount(tree: NodeTree): number {
  return tree.nodes.size;
}

export function rootNode(tree: NodeTree): Node {
  const root = tree.nodes.get(tree.root);
  // Unreachable via the public API: `createTree` seeds the root and `removeNode`
  // refuses to delete it. If this throws, the tree was built by hand or a
  // mutation has a bug — either way, failing loudly beats returning a fake node
  // that the renderer would happily draw.
  if (!root) throw new Error(`Tree root "${tree.root}" is missing from the node store.`);
  return root;
}

export function parentOf(tree: NodeTree, id: NodeId): Node | undefined {
  const parentId = tree.parents.get(id);
  return parentId === undefined ? undefined : tree.nodes.get(parentId);
}

export function parentIdOf(tree: NodeTree, id: NodeId): NodeId | undefined {
  return tree.parents.get(id);
}

export function childIdsOf(tree: NodeTree, id: NodeId): readonly NodeId[] {
  return tree.nodes.get(id)?.children ?? [];
}

export function childrenOf(tree: NodeTree, id: NodeId): readonly Node[] {
  const out: Node[] = [];
  for (const childId of childIdsOf(tree, id)) {
    const child = tree.nodes.get(childId);
    if (child) out.push(child);
  }
  return out;
}

/** Position among its siblings, or -1 for the root / an unknown node. */
export function siblingIndex(tree: NodeTree, id: NodeId): number {
  const parentId = tree.parents.get(id);
  if (parentId === undefined) return -1;
  return tree.nodes.get(parentId)?.children.indexOf(id) ?? -1;
}

/** Root-first: `[root, ..., parent]`. Empty for the root. The breadcrumb bar. */
export function ancestorIds(tree: NodeTree, id: NodeId): readonly NodeId[] {
  const out: NodeId[] = [];
  let current = tree.parents.get(id);
  while (current !== undefined) {
    out.unshift(current);
    current = tree.parents.get(current);
  }
  return out;
}

/** Root-first, inclusive: `[root, ..., id]`. */
export function nodePath(tree: NodeTree, id: NodeId): readonly NodeId[] {
  return hasNode(tree, id) ? [...ancestorIds(tree, id), id] : [];
}

export function depthOf(tree: NodeTree, id: NodeId): number {
  return ancestorIds(tree, id).length;
}

/**
 * Is `ancestorId` at or above `id`?
 *
 * Walks UP from `id` via the parent index rather than down from `ancestorId`,
 * which is O(depth) instead of O(subtree) — depth is single digits in real
 * documents. This is the cycle guard `canMoveNode` depends on, so it is on the
 * hot path of every drag.
 */
export function isAncestor(tree: NodeTree, ancestorId: NodeId, id: NodeId): boolean {
  if (ancestorId === id) return true;

  let current = tree.parents.get(id);
  while (current !== undefined) {
    if (current === ancestorId) return true;
    current = tree.parents.get(current);
  }
  return false;
}

/**
 * Every id in `id`'s subtree, `id` first, in document order.
 *
 * Iterative, not recursive: a deeply nested imported document (Phase G accepts
 * arbitrary HTML, which is adversarial input) must not blow the call stack.
 */
export function subtreeIds(tree: NodeTree, id: NodeId): readonly NodeId[] {
  if (!hasNode(tree, id)) return [];

  const out: NodeId[] = [];
  const stack: NodeId[] = [id];
  while (stack.length > 0) {
    const current = stack.pop() as NodeId;
    out.push(current);

    const children = tree.nodes.get(current)?.children ?? [];
    // Reversed, so popping yields left-to-right document order.
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as NodeId);
  }
  return out;
}

/** `subtreeIds` without the node itself. */
export function descendantIds(tree: NodeTree, id: NodeId): readonly NodeId[] {
  return subtreeIds(tree, id).slice(1);
}

/** Every node in document order — the exporter's walk. */
export function walk(tree: NodeTree): readonly Node[] {
  const out: Node[] = [];
  for (const id of subtreeIds(tree, tree.root)) {
    const node = tree.nodes.get(id);
    if (node) out.push(node);
  }
  return out;
}

export function findNodes(tree: NodeTree, predicate: (node: Node) => boolean): readonly Node[] {
  return walk(tree).filter(predicate);
}

/**
 * Every node carrying a class.
 *
 * "Delete the class `.btn`" must not leave nodes referencing a class with no
 * rules, and the style panel wants "used by 14 elements" before it lets you.
 */
export function nodesWithClass(tree: NodeTree, name: ClassName): readonly Node[] {
  return findNodes(tree, (node) => node.classes.includes(name));
}

/** Every asset used anywhere in the tree. Asset GC and export bundling. */
export function treeAssets(tree: NodeTree): readonly AssetId[] {
  const out = new Set<AssetId>();
  for (const node of walk(tree)) {
    for (const asset of referencedAssets(node.props)) out.add(asset);
  }
  return [...out];
}

/* --------------------------------------------------------------- writing */

function withNode(tree: NodeTree, node: Node): NodeTree {
  const nodes = new Map(tree.nodes);
  nodes.set(node.id, node);
  return { ...tree, nodes };
}

/**
 * Replace one node, keeping its position.
 *
 * `children` is taken from the node ALREADY IN THE TREE, not from the caller's
 * copy. Every structural edit goes through `insertNode`/`moveNode`/`removeNode`,
 * which maintain the parent index; letting an `updateNode` caller pass a
 * different `children` array would change structure without touching `parents`
 * and corrupt the tree silently. Callers doing `updateNode(tree, {...node,
 * children: []})` — a plausible way to try to clear children — get a no-op
 * instead of a broken index.
 */
export function updateNode(tree: NodeTree, node: Node): NodeTree {
  const existing = tree.nodes.get(node.id);
  if (!existing) return tree;
  return withNode(tree, { ...node, children: existing.children });
}

/** `update` receives the current node. A no-op if `id` is unknown. */
export function updateNodeBy(tree: NodeTree, id: NodeId, update: (node: Node) => Node): NodeTree {
  const existing = tree.nodes.get(id);
  if (!existing) return tree;
  return updateNode(tree, update(existing));
}

function spliceChildren(
  tree: NodeTree,
  parentId: NodeId,
  mutate: (children: NodeId[]) => void,
): NodeTree {
  const parent = tree.nodes.get(parentId);
  if (!parent) return tree;

  const children = [...parent.children];
  mutate(children);
  return withNode(tree, { ...parent, children });
}

/**
 * Clamp rather than reject an out-of-range index.
 *
 * Drop targets are computed from pointer geometry against a live DOM, and a drop
 * that lands one past the end during a re-layout is a routine race, not a bug in
 * the caller. Clamping puts the node where the user obviously meant; throwing
 * would turn a common race into a lost drag.
 */
function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined) return length;
  return Math.max(0, Math.min(Math.trunc(index), length));
}

/**
 * Insert a NEW node at `index` among `parentId`'s children (appending if `index`
 * is omitted).
 *
 * Insert-at-index is the capability the prototype lacked outright — its
 * `insertNode` could only append (AUDIT §4.4), which is why it had no
 * insert-before, no insert-after, and no drop position.
 *
 * The node must not already be in the tree and must have no children: this is for
 * minting, not moving (`moveNode`) and not pasting (`insertSubtree`). Enforced
 * because an unenforced version would insert a node whose children exist only in
 * its own array and never in `nodes` — a tree that validates as fine but renders
 * nothing.
 */
export function insertNode(tree: NodeTree, node: Node, parentId: NodeId, index?: number): NodeTree {
  if (tree.nodes.has(node.id)) return tree;
  if (node.children.length > 0) return tree;

  const parent = tree.nodes.get(parentId);
  if (!parent) return tree;

  const at = clampIndex(index, parent.children.length);
  const nodes = new Map(tree.nodes);
  nodes.set(node.id, node);

  const children = [...parent.children];
  children.splice(at, 0, node.id);
  nodes.set(parentId, { ...parent, children });

  const parents = new Map(tree.parents);
  parents.set(node.id, parentId);

  return { ...tree, nodes, parents };
}

/**
 * Insert a whole detached subtree — paste, duplicate, and the Phase G HTML
 * importer, which builds a subtree bottom-up before it has anywhere to put it.
 *
 * `subtree` must be self-contained: every child id referenced must be present in
 * the array, and no id may already exist in the tree. Rejected wholesale rather
 * than partially applied, because half a pasted subtree is worse than none.
 */
export function insertSubtree(
  tree: NodeTree,
  subtree: readonly Node[],
  subtreeRootId: NodeId,
  parentId: NodeId,
  index?: number,
): NodeTree {
  const parent = tree.nodes.get(parentId);
  if (!parent) return tree;

  const incoming = new Map(subtree.map((node) => [node.id, node]));
  if (incoming.size !== subtree.length) return tree;
  if (!incoming.has(subtreeRootId)) return tree;

  for (const node of subtree) {
    if (tree.nodes.has(node.id)) return tree;
    for (const childId of node.children) {
      if (!incoming.has(childId)) return tree;
    }
  }

  const nodes = new Map(tree.nodes);
  const parents = new Map(tree.parents);
  for (const node of subtree) {
    nodes.set(node.id, node);
    for (const childId of node.children) parents.set(childId, node.id);
  }
  // Any node that is not the subtree's root but has no parent within the subtree
  // is unreachable — a detached fragment riding along with the paste.
  for (const node of subtree) {
    if (node.id !== subtreeRootId && !parents.has(node.id)) return tree;
  }

  const at = clampIndex(index, parent.children.length);
  const children = [...parent.children];
  children.splice(at, 0, subtreeRootId);
  nodes.set(parentId, { ...parent, children });
  parents.set(subtreeRootId, parentId);

  return { ...tree, nodes, parents };
}

/**
 * Remove a node and its whole subtree.
 *
 * Returns the removed ids alongside the tree because the caller MUST clean up
 * after them: node-scoped style rules are keyed by node id, so dropping a subtree
 * without calling `removeScope(sheet, nodeScope(id))` for each leaks rules
 * forever and grows the exported CSS with every edit session. Returning the ids
 * makes that cleanup possible; putting them in the return type makes it hard to
 * forget.
 *
 * Removing the root is refused — a page with no root has no tree.
 */
export function removeNode(
  tree: NodeTree,
  id: NodeId,
): { readonly tree: NodeTree; readonly removed: readonly NodeId[] } {
  if (id === tree.root || !tree.nodes.has(id)) return { tree, removed: [] };

  const removed = subtreeIds(tree, id);
  const nodes = new Map(tree.nodes);
  const parents = new Map(tree.parents);
  for (const removedId of removed) {
    nodes.delete(removedId);
    parents.delete(removedId);
  }

  const parentId = tree.parents.get(id);
  if (parentId !== undefined) {
    const parent = nodes.get(parentId);
    if (parent) {
      nodes.set(parentId, { ...parent, children: parent.children.filter((c) => c !== id) });
    }
  }

  return { tree: { ...tree, nodes, parents }, removed };
}

/**
 * May `id` be moved into `newParentId`?
 *
 * THE CYCLE GUARD. Dropping a node into its own descendant detaches that whole
 * branch from the root into a ring that points at itself: the layer panel
 * recurses forever, `ancestorIds` never terminates, and the document is
 * unrecoverable — the user's page is simply gone. Every tree editor must answer
 * this before every drop, and it is checked here, in the model, rather than in
 * the drag-and-drop UI, because a paste or a plugin can reparent without any drag
 * being involved.
 *
 * `isAncestor` is inclusive, so it also rejects dropping a node into itself.
 *
 * Structural only. Whether the parent's COMPONENT accepts the child is
 * `canInsertComponent`, which needs a registry — see the note there.
 */
export function canMoveNode(tree: NodeTree, id: NodeId, newParentId: NodeId): boolean {
  if (id === tree.root) return false;
  if (!tree.nodes.has(id) || !tree.nodes.has(newParentId)) return false;
  return !isAncestor(tree, id, newParentId);
}

/**
 * Move a node to `index` among `newParentId`'s children. Reparents and reorders;
 * they are the same operation.
 *
 * A no-op if `canMoveNode` rejects it, matching how `removeRule` and
 * `unsetProperty` treat impossible requests. The UI asks `canMoveNode` to decide
 * whether to draw the drop indicator at all.
 *
 * INDEX SEMANTICS — `index` is a position in `newParentId.children` AS IT LOOKS
 * NOW, before the move. That is what a drop indicator means: the user points at a
 * gap in the list they can see. But the move removes the node first, which shifts
 * every later sibling down one, so a same-parent move to a LATER index must be
 * decremented or the node lands one slot too far right. Dragging item 0 to the
 * gap after item 3 is `index: 4`, and naively re-inserting at 4 in the
 * now-3-element array puts it at the end — a bug the user reproduces on their
 * first drag and never trusts the editor again after.
 */
export function moveNode(
  tree: NodeTree,
  id: NodeId,
  newParentId: NodeId,
  index?: number,
): NodeTree {
  if (!canMoveNode(tree, id, newParentId)) return tree;

  const oldParentId = tree.parents.get(id);
  if (oldParentId === undefined) return tree;

  const newParent = tree.nodes.get(newParentId);
  if (!newParent) return tree;

  const sameParent = oldParentId === newParentId;
  const currentIndex = (tree.nodes.get(oldParentId)?.children ?? []).indexOf(id);

  let at = clampIndex(index, newParent.children.length);
  if (sameParent && currentIndex !== -1 && at > currentIndex) at -= 1;

  let next = spliceChildren(tree, oldParentId, (children) => {
    const found = children.indexOf(id);
    if (found !== -1) children.splice(found, 1);
  });

  next = spliceChildren(next, newParentId, (children) => {
    children.splice(Math.min(at, children.length), 0, id);
  });

  if (sameParent) return next;

  const parents = new Map(next.parents);
  parents.set(id, newParentId);
  return { ...next, parents };
}

/**
 * Deep-copy a subtree with fresh ids, inserted next to the original.
 *
 * Ids must be regenerated rather than reused — two nodes sharing an id would make
 * `nodes` collide and node-scoped style rules apply to both. Node-scoped RULES
 * are deliberately NOT copied here: `@vpb/core`'s tree layer knows nothing about
 * the stylesheet, so Phase C's DuplicateNode command pairs this with a rule copy,
 * using the returned id mapping to translate old node ids to new ones.
 */
export function duplicateNode(
  tree: NodeTree,
  id: NodeId,
  ids: IdFactory,
): {
  readonly tree: NodeTree;
  readonly newId: NodeId | undefined;
  /** old id -> new id, for the caller's style-rule copy. */
  readonly idMap: ReadonlyMap<NodeId, NodeId>;
} {
  const parentId = tree.parents.get(id);
  if (parentId === undefined || !tree.nodes.has(id)) {
    return { tree, newId: undefined, idMap: new Map() };
  }

  const originalIds = subtreeIds(tree, id);
  const idMap = new Map<NodeId, NodeId>();
  for (const originalId of originalIds) idMap.set(originalId, ids.node());

  const copies: Node[] = [];
  for (const originalId of originalIds) {
    const original = tree.nodes.get(originalId);
    if (!original) continue;
    copies.push({
      ...original,
      id: idMap.get(originalId) as NodeId,
      children: original.children.map((childId) => idMap.get(childId) as NodeId),
    });
  }

  const newId = idMap.get(id) as NodeId;
  const next = insertSubtree(tree, copies, newId, parentId, siblingIndex(tree, id) + 1);
  return { tree: next, newId, idMap };
}

/* ------------------------------------------------------------ validation */

/**
 * Component-aware insert check.
 *
 * SEPARATE from `canMoveNode`, and it takes the registry the structural checks do
 * not. The tree layer is deliberately registry-free — it is pure structure, so it
 * stays testable without a registry and cannot be broken by a bad plugin — while
 * component RULES (may a Heading hold children? may a Tab sit here?) live with the
 * definitions that declare them. The drag-and-drop engine and Phase C's commands
 * call both; that separation mirrors `validateStyleSheet` (structural) versus
 * `orphanedRules` (needs the breakpoint set).
 */
export function canInsertComponent(
  tree: NodeTree,
  registry: ComponentRegistry,
  parentId: NodeId,
  childComponentId: ComponentId,
): boolean {
  const parent = tree.nodes.get(parentId);
  if (!parent) return false;

  const parentDefinition = getComponent(registry, parent.component);
  const childDefinition = getComponent(registry, childComponentId);
  if (!parentDefinition || !childDefinition) return false;

  return canContain(parentDefinition, childDefinition);
}

/** `canMoveNode` and the component rules together — what a drop must satisfy. */
export function canDropNode(
  tree: NodeTree,
  registry: ComponentRegistry,
  id: NodeId,
  newParentId: NodeId,
): boolean {
  if (!canMoveNode(tree, id, newParentId)) return false;

  const node = tree.nodes.get(id);
  if (!node) return false;
  if (node.locked) return false;

  return canInsertComponent(tree, registry, newParentId, node.component);
}

/**
 * Verify the tree's structure and its derived parent index agree.
 *
 * Same contract as `validateStyleSheet`: called by tests after EVERY mutation, so
 * an index bug surfaces at the operation that caused it rather than three phases
 * later as a node that cannot be found or a layer panel that recurses forever.
 */
export function validateTree(tree: NodeTree): readonly string[] {
  const errors: string[] = [];

  if (!tree.nodes.has(tree.root)) errors.push(`Root "${tree.root}" is not in the node store.`);
  if (tree.parents.has(tree.root)) errors.push(`Root "${tree.root}" has a parent.`);

  for (const [id, node] of tree.nodes) {
    if (node.id !== id) errors.push(`Node "${node.id}" is stored under key "${id}".`);

    const seen = new Set<NodeId>();
    for (const childId of node.children) {
      if (seen.has(childId)) errors.push(`Node "${id}" lists child "${childId}" twice.`);
      seen.add(childId);

      if (!tree.nodes.has(childId)) {
        errors.push(`Node "${id}" has missing child "${childId}".`);
        continue;
      }
      const recordedParent = tree.parents.get(childId);
      if (recordedParent !== id) {
        errors.push(
          `Node "${childId}" is a child of "${id}" but its parent is recorded as "${recordedParent ?? 'none'}".`,
        );
      }
    }
  }

  for (const [id, parentId] of tree.parents) {
    if (!tree.nodes.has(id)) errors.push(`Parent index references missing node "${id}".`);
    const parent = tree.nodes.get(parentId);
    if (!parent) {
      errors.push(`Node "${id}" records missing parent "${parentId}".`);
      continue;
    }
    if (!parent.children.includes(id)) {
      errors.push(`Node "${id}" records parent "${parentId}", which does not list it as a child.`);
    }
  }

  // Reachability catches both orphans and cycles: a cycle detaches its ring from
  // the root, so its members are never visited. Checked by walking from the root
  // rather than by trusting `parents`, which is the thing under suspicion.
  const reachable = new Set(subtreeIds(tree, tree.root));
  for (const id of tree.nodes.keys()) {
    if (!reachable.has(id)) {
      errors.push(`Node "${id}" is not reachable from the root (orphaned or in a cycle).`);
    }
  }

  return errors;
}

/**
 * Nodes whose component is not registered.
 *
 * The counterpart to `orphanedRules`, and the same reasoning: a project may be
 * opened without the plugin that defined some of its components. Those nodes must
 * NOT be deleted — the user would lose work permanently because a plugin failed
 * to load — so they stay, inert, and are reported here so the UI can say "3
 * elements need the Acme plugin".
 */
export function unknownComponentNodes(
  tree: NodeTree,
  registry: ComponentRegistry,
): readonly Node[] {
  return walk(tree).filter((node) => !getComponent(registry, node.component));
}
