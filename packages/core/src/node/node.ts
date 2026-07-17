import type { IdFactory } from '../identity/idFactory.ts';
import type { ClassName, ComponentId, NodeId } from '../identity/ids.ts';
import type { ComponentDefinition } from './component.ts';
import { initialProps } from './component.ts';
import type { PropValue, PropValues } from './props.ts';
import { EMPTY_PROPS, setProp, unsetProp } from './props.ts';

/**
 * One element in a page.
 *
 * CHILDREN ARE IDS, NOT NODES. This is the single most consequential line in the
 * file. The prototype nested node objects, so `updateNode` had to rebuild every
 * ancestor of the edited node and `.map()` every child in the entire tree
 * (AUDIT §4.4) — a full structural clone per keystroke, against a spec asking for
 * "thousands of nodes". With ids, the tree is a flat `Map` (see `tree.ts`): an
 * edit copies the map's pointers and replaces ONE node. Nothing else moves.
 *
 * It also makes the id -> node index possible at all. A nested tree cannot have
 * an index that stays correct, because every edit replaces the objects the index
 * points at.
 *
 * NO `parentId` FIELD, deliberately. Parent is derived and lives in the tree's
 * index. Storing it here too would mean two sources of truth for one fact, and
 * the moment a move updates one and not the other the tree is quietly corrupt.
 * `parentOf(tree, id)` is O(1) anyway.
 */
export interface Node {
  readonly id: NodeId;
  readonly component: ComponentId;
  readonly props: PropValues;
  /**
   * Classes are ORDERED and this is a list, not a Set: the order is what the user
   * sees in the style panel's class chips, and it round-trips to `class="a b"`.
   * Duplicates are prevented by `addClass`.
   *
   * Note that a class here is only a REFERENCE — the declarations live in the
   * stylesheet under `classScope(name)`. Nothing about a node's appearance is
   * stored on the node, which is why editing `.btn` updates every button.
   */
  readonly classes: readonly ClassName[];
  readonly children: readonly NodeId[];
  /**
   * The layer-panel name. Absent means "show the component's label", so a tree of
   * unnamed boxes reads as "Box" rather than "Untitled 47", and renaming back to
   * empty restores the default instead of persisting a blank row.
   */
  readonly name?: string;
  /** Visible in the canvas but not selectable/draggable. */
  readonly locked?: boolean;
  /** Hidden in the canvas AND omitted from export — the layer panel's eye icon. */
  readonly hidden?: boolean;
}

/**
 * Mint a node from its component definition, with that component's default props
 * and classes already applied.
 *
 * Takes the definition rather than a bare `ComponentId` so a node can never be
 * created for a component that is not registered — the failure mode would be an
 * un-renderable node in a saved project, which is unrecoverable for the user.
 */
export function createNode(
  definition: ComponentDefinition,
  ids: IdFactory,
  overrides: {
    readonly props?: PropValues;
    readonly classes?: readonly ClassName[];
    readonly name?: string;
  } = {},
): Node {
  return {
    id: ids.node(),
    component: definition.id,
    props: { ...initialProps(definition), ...overrides.props },
    classes: overrides.classes ?? definition.defaultClasses ?? [],
    children: [],
    ...(overrides.name === undefined ? {} : { name: overrides.name }),
  };
}

/** The layer panel's label for a node. */
export function nodeName(node: Node, definition?: ComponentDefinition): string {
  return node.name ?? definition?.label ?? node.component;
}

export function setNodeProp(node: Node, name: string, value: PropValue): Node {
  return { ...node, props: setProp(node.props, name, value) };
}

export function unsetNodeProp(node: Node, name: string): Node {
  const props = unsetProp(node.props, name);
  return props === node.props ? node : { ...node, props };
}

export function setNodeProps(node: Node, props: PropValues): Node {
  return { ...node, props };
}

export function hasClass(node: Node, name: ClassName): boolean {
  return node.classes.includes(name);
}

/** Appends. A no-op if already present — order is preserved, not reset. */
export function addClass(node: Node, name: ClassName): Node {
  if (hasClass(node, name)) return node;
  return { ...node, classes: [...node.classes, name] };
}

export function removeClass(node: Node, name: ClassName): Node {
  if (!hasClass(node, name)) return node;
  return { ...node, classes: node.classes.filter((c) => c !== name) };
}

export function setClasses(node: Node, classes: readonly ClassName[]): Node {
  return { ...node, classes: [...new Set(classes)] };
}

export function renameNode(node: Node, name: string | undefined): Node {
  const trimmed = name?.trim();
  // Empty means "revert to the component label", not "a node named nothing".
  if (!trimmed) {
    if (node.name === undefined) return node;
    const { name: _dropped, ...rest } = node;
    return rest;
  }
  return { ...node, name: trimmed };
}

export function setLocked(node: Node, locked: boolean): Node {
  return locked ? { ...node, locked: true } : stripFlag(node, 'locked');
}

export function setHidden(node: Node, hidden: boolean): Node {
  return hidden ? { ...node, hidden: true } : stripFlag(node, 'hidden');
}

/**
 * Delete rather than set `false`, so a default node is `{...}` and not
 * `{locked: false, hidden: false}`. Keeps saved projects free of noise and makes
 * structural equality in tests mean what it looks like it means.
 */
function stripFlag(node: Node, flag: 'locked' | 'hidden'): Node {
  if (node[flag] === undefined) return node;
  const next = { ...node };
  delete next[flag];
  return next;
}

export const EMPTY_NODE_PROPS = EMPTY_PROPS;
