import type { Node, NodeId, NodeTree, Page, Project, StyleRule } from '@vpb/core';
import {
  canDropNode,
  canInsertComponent,
  getComponent,
  getNode,
  insertNode,
  insertSubtree,
  moveNode,
  nodeScope,
  parentIdOf,
  putRule,
  removeNode,
  removeScope,
  rulesForScope,
  setPageTree,
  siblingIndex,
  subtreeIds,
  updatePageBy,
} from '@vpb/core';

import type { Command, EditorEnvironment } from '../command.ts';
import { refuse, succeed } from '../command.ts';
import { activePage, select, type EditorState } from '../editorState.ts';

/**
 * Structural commands: insert, remove, move.
 *
 * Each delegates the actual tree surgery to `@vpb/core` rather than reimplementing
 * it — the cycle guard, the parent index, and the drag off-by-one are already
 * proven there by mutation testing, and a second implementation here would be a
 * second thing to keep correct. What this layer adds is what core deliberately
 * has no opinion about: preconditions surfaced as reasons, the node-scoped style
 * rules that live in the project rather than the tree, selection, and an inverse.
 */

/* --------------------------------------------------------------- helpers */

/** Replace the active page's tree. */
function withTree(state: EditorState, tree: NodeTree): EditorState {
  return {
    ...state,
    project: updatePageBy(state.project, state.context.activePageId, (page: Page) =>
      setPageTree(page, tree),
    ),
  };
}

/**
 * Every node-scoped rule for these nodes, and the project with them gone.
 *
 * Deleting a node must delete the rules scoped to it or they outlive it forever:
 * `orphanedNodeScopes` exists precisely to catch the caller who forgets. But undo
 * has to bring them back, so they are *returned* rather than merely dropped —
 * a delete that silently discarded a node's styling would "undo" into an
 * unstyled node, which is data loss wearing an undo's clothes.
 */
function detachNodeStyles(
  project: Project,
  ids: readonly NodeId[],
): { readonly project: Project; readonly rules: readonly StyleRule[] } {
  const rules: StyleRule[] = [];
  let styles = project.styles;

  for (const id of ids) {
    const scope = nodeScope(id);
    rules.push(...rulesForScope(styles, scope));
    styles = removeScope(styles, scope);
  }

  return { project: { ...project, styles }, rules };
}

function reattachStyles(project: Project, rules: readonly StyleRule[]): Project {
  let styles = project.styles;
  for (const rule of rules) styles = putRule(styles, rule);
  return { ...project, styles };
}

/* ---------------------------------------------------------------- insert */

/**
 * Insert a node that has already been minted.
 *
 * THE NODE IS AN ARGUMENT, NOT MINTED HERE, and that is not an accident of
 * signature. If this command called `ids.node()` inside `apply`, then undo
 * followed by redo would insert a node with a DIFFERENT id than the one the user
 * just had: any node-scoped style rule written against the first id would be
 * orphaned, and the selection would point at a node that no longer exists.
 * Minting belongs to the caller, once, before the command exists. The same rule
 * is why `insertSubtreeCommand` carries concrete nodes.
 */
export function insertNodeCommand(node: Node, parentId: NodeId, index?: number): Command {
  return {
    kind: 'insertNode',
    label: 'Insert',
    apply(state, env) {
      const tree = activePage(state).tree;

      if (tree.nodes.has(node.id)) return refuse(`Node ${node.id} is already in the tree.`);
      if (node.children.length > 0) {
        return refuse('insertNode takes a childless node; use insertSubtreeCommand to paste.');
      }
      if (!tree.nodes.has(parentId)) return refuse(`Parent ${parentId} is not in the tree.`);
      if (!canInsertComponent(tree, env.registry, parentId, node.component)) {
        return refuse(componentRefusal(env, parentId, node, tree));
      }

      const next = withTree(state, insertNode(tree, node, parentId, index));
      // Selecting the new node is what makes insert feel like a place-and-edit
      // rather than a create-then-hunt. Context, not document: see EditorContext.
      return succeed(select(next, [node.id]), removeNodeCommand(node.id));
    },
  };
}

/** A reason a human can act on, rather than "cannot insert". */
function componentRefusal(
  env: EditorEnvironment,
  parentId: NodeId,
  node: Node,
  tree: NodeTree,
): string {
  const parentNode = getNode(tree, parentId);
  const parent = parentNode && getComponent(env.registry, parentNode.component);
  const child = getComponent(env.registry, node.component);

  if (!child) return `Unknown component ${node.component}.`;
  if (!parent) return `Parent node ${parentId} has unknown component.`;
  return `${parent.label} cannot contain ${child.label}.`;
}

/* ---------------------------------------------------------------- remove */

/**
 * Delete a node and its subtree, with the style rules scoped to any of it.
 *
 * The inverse carries the whole subtree by value. That is the honest cost of
 * undoing a delete: the nodes have to be kept somewhere, and this is the one
 * command where the inverse is O(subtree) rather than O(1). It is still bounded
 * by what was deleted, where the prototype's history paid O(document) for every
 * edit including a single keystroke (AUDIT §4.3).
 */
export function removeNodeCommand(id: NodeId): Command {
  return {
    kind: 'removeNode',
    label: 'Delete',
    apply(state) {
      const tree = activePage(state).tree;

      if (!tree.nodes.has(id)) return refuse(`Node ${id} is not in the tree.`);
      if (id === tree.root) return refuse('The page root cannot be deleted.');

      const parentId = parentIdOf(tree, id);
      if (parentId === undefined) return refuse(`Node ${id} has no parent.`);
      const index = siblingIndex(tree, id);

      // Capture BEFORE the removal: afterwards the nodes are unreachable, and an
      // inverse that cannot rebuild them is not an inverse.
      const removedIds = subtreeIds(tree, id);
      const nodes = removedIds.map((removedId) => tree.nodes.get(removedId)).filter(isNode);

      const { tree: nextTree } = removeNode(tree, id);
      const detached = detachNodeStyles(withTree(state, nextTree).project, removedIds);

      const next: EditorState = { ...state, project: detached.project };

      // The deleted nodes cannot stay selected. `select` filters ids that are no
      // longer in the tree, so this both drops them and keeps the survivors.
      return succeed(
        select(next, state.context.selection),
        insertSubtreeCommand(nodes, id, parentId, index, detached.rules),
      );
    },
  };
}

function isNode(node: Node | undefined): node is Node {
  return node !== undefined;
}

/**
 * Put a captured subtree back, with its style rules. The inverse of a delete,
 * and the paste half of cut/copy/paste in Phase E.
 *
 * `nodes` must contain the subtree root and every descendant; core's
 * `insertSubtree` validates that and refuses a subtree with a dangling child.
 */
export function insertSubtreeCommand(
  nodes: readonly Node[],
  subtreeRootId: NodeId,
  parentId: NodeId,
  index: number,
  rules: readonly StyleRule[] = [],
): Command {
  return {
    kind: 'insertSubtree',
    label: 'Restore',
    apply(state) {
      const tree = activePage(state).tree;
      if (!tree.nodes.has(parentId)) return refuse(`Parent ${parentId} is not in the tree.`);
      if (tree.nodes.has(subtreeRootId)) {
        return refuse(`Node ${subtreeRootId} is already in the tree.`);
      }

      const nextTree = insertSubtree(tree, nodes, subtreeRootId, parentId, index);
      const withStyles = reattachStyles(withTree(state, nextTree).project, rules);
      const next: EditorState = { ...state, project: withStyles };

      return succeed(select(next, [subtreeRootId]), removeNodeCommand(subtreeRootId));
    },
  };
}

/* ------------------------------------------------------------------ move */

/**
 * Move a node under a new parent at `index`.
 *
 * `index` is core's drag semantics: a position in `newParentId.children` AS THE
 * USER SEES IT, before the move. A drop indicator points at a gap in the list on
 * screen, which still contains the dragged node; core decrements a same-parent
 * later move to absorb the shift the removal causes.
 *
 * The inverse cannot reuse those semantics. It knows where the node must END UP,
 * and the pre-move index that produces that ending is a different number — which
 * is why undoing a move goes through `restoreNodePositionCommand` rather than
 * another `moveNodeCommand` with the old index. Getting this wrong is invisible
 * for reparenting moves and wrong only for same-parent reorders, i.e. exactly the
 * case a test written from the happy path would miss.
 */
export function moveNodeCommand(id: NodeId, newParentId: NodeId, index?: number): Command {
  return {
    kind: 'moveNode',
    label: 'Move',
    apply(state, env) {
      const tree = activePage(state).tree;

      if (!tree.nodes.has(id)) return refuse(`Node ${id} is not in the tree.`);
      if (id === tree.root) return refuse('The page root cannot be moved.');
      if (!tree.nodes.has(newParentId)) return refuse(`Parent ${newParentId} is not in the tree.`);
      if (!canDropNode(tree, env.registry, id, newParentId)) {
        return refuse(dropRefusal(state, env, id, newParentId));
      }

      const oldParentId = parentIdOf(tree, id);
      if (oldParentId === undefined) return refuse(`Node ${id} has no parent.`);
      const oldIndex = siblingIndex(tree, id);

      const next = withTree(state, moveNode(tree, id, newParentId, index));
      return succeed(next, restoreNodePositionCommand(id, oldParentId, oldIndex));
    },
  };
}

function dropRefusal(
  state: EditorState,
  env: EditorEnvironment,
  id: NodeId,
  newParentId: NodeId,
): string {
  const tree = activePage(state).tree;
  const node = getNode(tree, id);
  const parentNode = getNode(tree, newParentId);
  if (!node || !parentNode) return 'Node or parent is not in the tree.';

  // Distinguish the two refusals a drag actually hits, because they mean
  // different things to the user: one is "not there", the other is "not ever".
  if (!canDropNodeIgnoringCycle(state, id, newParentId)) {
    return 'A node cannot be moved into its own descendant.';
  }
  const child = getComponent(env.registry, node.component);
  const parent = getComponent(env.registry, parentNode.component);
  return child && parent
    ? `${parent.label} cannot contain ${child.label}.`
    : 'Unknown component in the move.';
}

function canDropNodeIgnoringCycle(state: EditorState, id: NodeId, newParentId: NodeId): boolean {
  const tree = activePage(state).tree;
  let current: NodeId | undefined = newParentId;
  while (current !== undefined) {
    if (current === id) return false;
    current = parentIdOf(tree, current);
  }
  return true;
}

/**
 * Put a node at an EXACT final index under a parent — the inverse of a move.
 *
 * Where `moveNodeCommand` takes the index the user pointed at, this takes the
 * index the node must occupy when the dust settles, and works out what to hand
 * `moveNode` at apply time. It has to be computed then rather than baked in at
 * construction, because between a move and its undo the parent's children can
 * have changed underneath it.
 */
export function restoreNodePositionCommand(
  id: NodeId,
  parentId: NodeId,
  finalIndex: number,
): Command {
  return {
    kind: 'restoreNodePosition',
    label: 'Move',
    apply(state, env) {
      const tree = activePage(state).tree;

      if (!tree.nodes.has(id)) return refuse(`Node ${id} is not in the tree.`);
      if (!tree.nodes.has(parentId)) return refuse(`Parent ${parentId} is not in the tree.`);
      if (!canDropNode(tree, env.registry, id, parentId)) {
        return refuse(dropRefusal(state, env, id, parentId));
      }

      const oldParentId = parentIdOf(tree, id);
      if (oldParentId === undefined) return refuse(`Node ${id} has no parent.`);
      const oldIndex = siblingIndex(tree, id);

      const next = withTree(
        state,
        moveNode(tree, id, parentId, preMoveIndexFor(tree, id, parentId, finalIndex)),
      );
      return succeed(next, restoreNodePositionCommand(id, oldParentId, oldIndex));
    },
  };
}

/**
 * The `index` to hand `moveNode` so the node lands exactly at `finalIndex`.
 *
 * Reparenting: the node is not in the target list yet, so the two indices agree.
 * Same parent: `moveNode` decrements any index past the node's current position
 * to absorb the removal — so to land at a later slot, ask for one past it.
 */
function preMoveIndexFor(tree: NodeTree, id: NodeId, parentId: NodeId, finalIndex: number): number {
  if (parentIdOf(tree, id) !== parentId) return finalIndex;
  const currentIndex = siblingIndex(tree, id);
  return finalIndex >= currentIndex ? finalIndex + 1 : finalIndex;
}
