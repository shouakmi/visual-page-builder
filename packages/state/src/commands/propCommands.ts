import type { ClassName, NodeId, NodeTree, Page, PropValue } from '@vpb/core';
import {
  acceptsPropValue,
  addClass,
  getComponent,
  getNode,
  getProp,
  hasClass,
  isValidClassName,
  propDefinition,
  removeClass,
  renameNode,
  setClasses,
  setNodeProp,
  setPageTree,
  unsetNodeProp,
  updateNodeBy,
  updatePageBy,
} from '@vpb/core';

import type { Command } from '../command.ts';
import { refuse, succeed } from '../command.ts';
import { activePage, type EditorState } from '../editorState.ts';

/**
 * Commands that edit a node itself: its props, its name, its classes.
 *
 * Everything here is O(1) to invert — the previous value is one field — which is
 * the common case the audit's snapshot history paid a full document clone for.
 */

/** Order-sensitive, because class order is cascade order. See `setNodeClassesCommand`. */
function sameClasses(a: readonly ClassName[], b: readonly ClassName[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

function withTree(state: EditorState, tree: NodeTree): EditorState {
  return {
    ...state,
    project: updatePageBy(state.project, state.context.activePageId, (page: Page) =>
      setPageTree(page, tree),
    ),
  };
}

/**
 * Set a prop on a node.
 *
 * Coalesces per (node, prop): typing into a heading's text is one entry, and
 * moving to a different prop starts a new one. AUDIT §4.3's `updateCss`
 * committed per character with no key at all.
 */
export function setNodePropCommand(id: NodeId, name: string, value: PropValue): Command {
  return {
    kind: 'setNodeProp',
    label: `Set ${name}`,
    coalesceKey: `setNodeProp:${id}:${name}`,
    apply(state, env) {
      const tree = activePage(state).tree;
      const node = getNode(tree, id);
      if (!node) return refuse(`Node ${id} is not in the tree.`);

      const component = getComponent(env.registry, node.component);
      if (!component) return refuse(`Node ${id} has unknown component ${node.component}.`);

      // The registry decides what a component's props are. Without this check a
      // typo writes a prop no renderer reads and no panel shows -- invisible
      // until export, and props are a discriminated union precisely so that
      // "which nodes use this asset?" stays answerable.
      const definition = propDefinition(component, name);
      if (!definition) return refuse(`${component.label} has no prop "${name}".`);
      if (!acceptsPropValue(definition, value)) {
        return refuse(`${component.label}.${name} does not accept a ${value.kind} value.`);
      }

      const previous = getProp(node.props, name);
      const next = withTree(
        state,
        updateNodeBy(tree, id, (current) => setNodeProp(current, name, value)),
      );

      return succeed(
        next,
        previous === undefined
          ? unsetNodePropCommand(id, name)
          : setNodePropCommand(id, name, previous),
      );
    },
  };
}

/** Remove a prop, reverting the node to the component's default for it. */
export function unsetNodePropCommand(id: NodeId, name: string): Command {
  return {
    kind: 'unsetNodeProp',
    label: `Clear ${name}`,
    apply(state) {
      const tree = activePage(state).tree;
      const node = getNode(tree, id);
      if (!node) return refuse(`Node ${id} is not in the tree.`);

      const previous = getProp(node.props, name);
      if (previous === undefined) return refuse(`Node ${id} has no prop "${name}" set.`);

      const next = withTree(
        state,
        updateNodeBy(tree, id, (current) => unsetNodeProp(current, name)),
      );
      return succeed(next, setNodePropCommand(id, name, previous));
    },
  };
}

/**
 * Rename a node in the layer panel.
 *
 * An empty name means "revert to the component's label", which core handles by
 * dropping the field — so the inverse of clearing a name is setting it back, and
 * the inverse of setting one on an unnamed node is clearing it.
 */
export function renameNodeCommand(id: NodeId, name: string | undefined): Command {
  return {
    kind: 'renameNode',
    label: 'Rename',
    coalesceKey: `renameNode:${id}`,
    apply(state) {
      const tree = activePage(state).tree;
      const node = getNode(tree, id);
      if (!node) return refuse(`Node ${id} is not in the tree.`);

      const previous = node.name;
      // Compared on the VALUE, not on object identity: `renameNode` returns a new
      // node whether or not the name differs, so a reference check here would
      // never fire and would read as a guard that works.
      if ((name?.trim() || undefined) === previous) return refuse('The name is unchanged.');

      const next = withTree(
        state,
        updateNodeBy(tree, id, (current) => renameNode(current, name)),
      );
      return succeed(next, renameNodeCommand(id, previous));
    },
  };
}

/**
 * Set a node's class list outright.
 *
 * Exists because CLASS ORDER IS CASCADE ORDER, and that makes it the only honest
 * inverse for the two commands below. `resolve.ts` builds an element's scopes as
 * `query.classes.map(classScope)` — "weakest first, later overrides earlier" —
 * so `.a .b` and `.b .a` are different elements as far as the resolver is
 * concerned.
 *
 * The consequence is easy to miss: undoing "remove `.a`" by *appending* `.a`
 * gives it back at the strongest position instead of its own, so a property `.a`
 * used to lose is now a property `.a` wins. The undo would look right in the
 * layer panel and silently change what the page renders. Capturing the whole
 * array sidesteps that entirely.
 */
export function setNodeClassesCommand(id: NodeId, classes: readonly ClassName[]): Command {
  return {
    kind: 'setNodeClasses',
    label: 'Set classes',
    apply(state) {
      const tree = activePage(state).tree;
      const node = getNode(tree, id);
      if (!node) return refuse(`Node ${id} is not in the tree.`);

      const invalid = classes.filter((name) => !isValidClassName(name));
      if (invalid.length > 0) return refuse(`Invalid class name(s): ${invalid.join(', ')}.`);

      const previous = node.classes;
      // `setClasses` de-duplicates, so compare against what it would actually
      // produce rather than the argument — otherwise passing [a, a] against [a]
      // would look like a change and take a history entry that does nothing.
      const deduped = [...new Set(classes)];
      if (sameClasses(previous, deduped)) return refuse('The classes are unchanged.');

      const next = withTree(
        state,
        updateNodeBy(tree, id, (current) => setClasses(current, classes)),
      );
      return succeed(next, setNodeClassesCommand(id, previous));
    },
  };
}

/**
 * Add a class to a node.
 *
 * The class's declarations live in the stylesheet under `classScope(name)`, not
 * on the node — so this adds a REFERENCE, and adding a class already styled
 * elsewhere immediately restyles this node. That is the point of classes, and it
 * is why the inverse leaves the rules alone: they are shared, and removing this
 * node's reference must not restyle every other node that has it.
 */
export function addClassCommand(id: NodeId, name: ClassName): Command {
  return {
    kind: 'addClass',
    label: `Add .${name}`,
    apply(state) {
      const tree = activePage(state).tree;
      const node = getNode(tree, id);
      if (!node) return refuse(`Node ${id} is not in the tree.`);

      // Refused rather than sanitised, exactly as core refuses a weird page path:
      // a class name reaches the exported CSS as an identifier.
      if (!isValidClassName(name)) return refuse(`"${name}" is not a valid class name.`);
      if (hasClass(node, name)) return refuse(`Node already has .${name}.`);

      const previous = node.classes;
      const next = withTree(
        state,
        updateNodeBy(tree, id, (current) => addClass(current, name)),
      );
      return succeed(next, setNodeClassesCommand(id, previous));
    },
  };
}

/**
 * Remove a class reference from a node.
 *
 * Inverts through `setNodeClassesCommand` rather than `addClassCommand` so the
 * class returns to its own position in the list. See that command for why the
 * difference is a rendering bug and not a cosmetic one.
 */
export function removeClassCommand(id: NodeId, name: ClassName): Command {
  return {
    kind: 'removeClass',
    label: `Remove .${name}`,
    apply(state) {
      const tree = activePage(state).tree;
      const node = getNode(tree, id);
      if (!node) return refuse(`Node ${id} is not in the tree.`);
      if (!hasClass(node, name)) return refuse(`Node does not have .${name}.`);

      const previous = node.classes;
      const next = withTree(
        state,
        updateNodeBy(tree, id, (current) => removeClass(current, name)),
      );
      return succeed(next, setNodeClassesCommand(id, previous));
    },
  };
}
