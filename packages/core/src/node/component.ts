import type { ClassName, ComponentId } from '../identity/ids.ts';
import type { PropDefinition, PropValues } from './props.ts';
import { acceptsPropValue } from './props.ts';

/**
 * THE COMPONENT REGISTRY.
 *
 * The prototype declared `NodeType = "section"|"div"|"text"|"image"|"button"` — a
 * compile-time union, hand-switched in the renderer AND the exporter (AUDIT
 * §7.1). Adding "Accordion" meant editing three files in this package. A
 * third-party plugin could not add a component at all: you cannot extend someone
 * else's union from outside their build. The audit calls this "the single most
 * consequential missing abstraction", and it is why the spec's 30+ components and
 * the plugin system are both blocked on this file.
 *
 * The fix is that a component is DATA, not a case in a switch. A definition
 * describes what a component is (tag, props, what it may contain); the renderer
 * and exporter consume that description generically. Registering "Accordion"
 * becomes `registerComponent(registry, accordionDefinition)` — no core change, so
 * a plugin can do it at runtime.
 *
 * Note what is NOT here: a `render` function. `@vpb/core` is framework-free (it
 * runs in Node tests, Electron main, and export workers), so it cannot hold a
 * React component. Phase D keeps a separate componentId -> React map in the
 * renderer. The definition is the contract; the mapping is per-host.
 */

export type ComponentCategory = 'layout' | 'typography' | 'media' | 'form' | 'interactive';

/**
 * What a component may contain.
 *
 *  - `none`  — void. An image has no children, ever.
 *  - `text`  — text via a prop, no element children. The prototype's text node
 *              did `return props.text` and silently DROPPED any children it had
 *              (AUDIT §6). Making "text-only" an explicit policy means the editor
 *              refuses the drop instead of accepting it and destroying content.
 *  - `flow`  — any children, subject to `allowedChildren` / `allowedParents`.
 */
export type ChildPolicy = 'none' | 'text' | 'flow';

export interface ComponentDefinition {
  readonly id: ComponentId;
  readonly label: string;
  readonly category: ComponentCategory;
  /**
   * The HTML element the renderer and exporter emit. One string, consumed by
   * both, so WYSIWYG cannot drift between canvas and export — the prototype's
   * exporter had its own independent switch, which is how it managed to export
   * markup that did not match the canvas (AUDIT §6).
   */
  readonly tag: string;
  readonly children: ChildPolicy;
  readonly props: readonly PropDefinition[];
  readonly defaultProps?: PropValues;
  /** Classes applied on insert, so a dropped Button looks like a button. */
  readonly defaultClasses?: readonly ClassName[];
  /**
   * Structural constraints, both optional and both defaulting to "anything".
   *
   * These exist for the compound components Phase H needs — a Tab may only sit
   * inside Tabs, a ListItem only inside a List. Expressed as data on the
   * definition rather than as rules inside the drag-and-drop engine, so a plugin
   * author gets the same expressive power as a builtin. Enforced by `canInsert`.
   */
  readonly allowedChildren?: readonly ComponentId[];
  readonly allowedParents?: readonly ComponentId[];
  /** Root/system components the user must not delete or drag away. */
  readonly locked?: boolean;
  readonly description?: string;
}

export interface ComponentRegistry {
  readonly components: ReadonlyMap<ComponentId, ComponentDefinition>;
}

export const EMPTY_REGISTRY: ComponentRegistry = { components: new Map() };

export function createRegistry(
  definitions: readonly ComponentDefinition[] = [],
): ComponentRegistry {
  let registry = EMPTY_REGISTRY;
  for (const definition of definitions) registry = registerComponent(registry, definition);
  return registry;
}

/**
 * Add or replace a definition.
 *
 * Last write wins, which is what makes a plugin able to override a builtin
 * (swap the stock Button for a design-system Button and every existing Button
 * node re-renders — no migration, because nodes reference the id, not the
 * definition). The cost is that two plugins claiming one id silently fight;
 * `validateRegistry` cannot see that, so ids are namespaced (see `builtins.ts`).
 */
export function registerComponent(
  registry: ComponentRegistry,
  definition: ComponentDefinition,
): ComponentRegistry {
  const components = new Map(registry.components);
  components.set(definition.id, definition);
  return { components };
}

export function unregisterComponent(
  registry: ComponentRegistry,
  id: ComponentId,
): ComponentRegistry {
  if (!registry.components.has(id)) return registry;

  const components = new Map(registry.components);
  components.delete(id);
  return { components };
}

export function getComponent(
  registry: ComponentRegistry,
  id: ComponentId,
): ComponentDefinition | undefined {
  return registry.components.get(id);
}

export function hasComponent(registry: ComponentRegistry, id: ComponentId): boolean {
  return registry.components.has(id);
}

export function allComponents(registry: ComponentRegistry): readonly ComponentDefinition[] {
  return [...registry.components.values()];
}

export function componentsInCategory(
  registry: ComponentRegistry,
  category: ComponentCategory,
): readonly ComponentDefinition[] {
  return allComponents(registry).filter((c) => c.category === category);
}

export function propDefinition(
  definition: ComponentDefinition,
  name: string,
): PropDefinition | undefined {
  return definition.props.find((p) => p.name === name);
}

/**
 * The props a freshly inserted node starts with: every declared default, plus any
 * explicit `defaultProps` override.
 */
export function initialProps(definition: ComponentDefinition): PropValues {
  const props: Record<string, PropValues[string]> = {};
  for (const prop of definition.props) {
    if (prop.defaultValue) props[prop.name] = prop.defaultValue;
  }
  return { ...props, ...definition.defaultProps };
}

/**
 * Can a `child` component sit inside a `parent` component?
 *
 * Both directions are checked because the two constraints answer different
 * questions and a compound component needs both: `Tabs.allowedChildren = [Tab]`
 * stops a Heading being dropped into Tabs, while `Tab.allowedParents = [Tabs]`
 * stops a Tab being dropped onto the page root. Neither implies the other.
 */
export function canContain(parent: ComponentDefinition, child: ComponentDefinition): boolean {
  if (parent.children !== 'flow') return false;
  if (parent.allowedChildren && !parent.allowedChildren.includes(child.id)) return false;
  if (child.allowedParents && !child.allowedParents.includes(parent.id)) return false;
  return true;
}

/**
 * Report — never throw on — prop problems.
 *
 * Returns messages for the props panel. A node with a missing required prop is
 * still a legitimate node in the tree (a just-dropped Image has no `src` yet);
 * the editor should badge it, not refuse it.
 */
export function validateProps(
  definition: ComponentDefinition,
  props: PropValues,
): readonly string[] {
  const errors: string[] = [];

  for (const [name, value] of Object.entries(props)) {
    const prop = propDefinition(definition, name);
    if (!prop) {
      errors.push(`"${definition.label}" has no prop "${name}".`);
      continue;
    }
    if (!acceptsPropValue(prop, value)) {
      errors.push(
        `Prop "${name}" on "${definition.label}" expects ${prop.type}, got ${value.kind}.`,
      );
    }
  }

  for (const prop of definition.props) {
    if (prop.required && !(prop.name in props)) {
      errors.push(`Prop "${prop.name}" is required on "${definition.label}".`);
    }
  }

  return errors;
}

/**
 * Check the registry itself is coherent.
 *
 * Mostly a guard against plugin authors: a definition that references a component
 * id that was never registered produces a constraint that can never be satisfied,
 * and the failure surfaces later as "the editor refuses my drop" with no
 * explanation. Catching it at registration turns a mystery into a message.
 */
export function validateRegistry(registry: ComponentRegistry): readonly string[] {
  const errors: string[] = [];

  for (const [id, definition] of registry.components) {
    if (definition.id !== id) {
      errors.push(`Component "${definition.id}" is registered under key "${id}".`);
    }
    if (definition.tag.trim() === '') errors.push(`Component "${id}" has an empty tag.`);

    if (definition.children !== 'flow' && definition.allowedChildren) {
      errors.push(`Component "${id}" declares allowedChildren but does not accept children.`);
    }

    for (const childId of definition.allowedChildren ?? []) {
      if (!registry.components.has(childId)) {
        errors.push(`Component "${id}" allows unknown child "${childId}".`);
      }
    }
    for (const parentId of definition.allowedParents ?? []) {
      if (!registry.components.has(parentId)) {
        errors.push(`Component "${id}" allows unknown parent "${parentId}".`);
      }
    }

    const seen = new Set<string>();
    for (const prop of definition.props) {
      if (seen.has(prop.name)) errors.push(`Component "${id}" declares prop "${prop.name}" twice.`);
      seen.add(prop.name);

      if (prop.type === 'select' && (prop.options ?? []).length === 0) {
        errors.push(`Prop "${prop.name}" on "${id}" is a select with no options.`);
      }
      if (prop.defaultValue && !acceptsPropValue(prop, prop.defaultValue)) {
        errors.push(`Prop "${prop.name}" on "${id}" has a default that its own type rejects.`);
      }
    }
  }

  return errors;
}
