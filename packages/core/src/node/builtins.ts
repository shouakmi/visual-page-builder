import type { ComponentId } from '../identity/ids.ts';
import { unsafeId } from '../identity/ids.ts';
import type { ComponentDefinition, ComponentRegistry } from './component.ts';
import { createRegistry } from './component.ts';
import { propBoolean, propString } from './props.ts';

/**
 * The builtin component set.
 *
 * NAMESPACED, and stable forever. Like `BASE_BREAKPOINT_ID`, these ids are
 * persisted inside every project file — every node references its component by
 * id, so renaming one orphans every node using it in every saved project. The
 * `vpb:` prefix reserves our namespace: a plugin ships `acme:carousel` and can
 * never collide with a builtin we add later. That collision is otherwise
 * guaranteed the first time someone names their component "Section".
 *
 * Deliberately small. This is the registry's proof of concept, not the component
 * library — Phase H builds the 30+ components the spec asks for, and the point of
 * the registry is that doing so requires no change to this package. These six
 * cover the prototype's entire hardcoded union (section/div/text/image/button)
 * plus a link, which is enough to model a real page.
 */

export const BODY_COMPONENT_ID = unsafeId<ComponentId>('vpb:body');
export const SECTION_COMPONENT_ID = unsafeId<ComponentId>('vpb:section');
export const BOX_COMPONENT_ID = unsafeId<ComponentId>('vpb:box');
export const HEADING_COMPONENT_ID = unsafeId<ComponentId>('vpb:heading');
export const TEXT_COMPONENT_ID = unsafeId<ComponentId>('vpb:text');
export const IMAGE_COMPONENT_ID = unsafeId<ComponentId>('vpb:image');
export const LINK_COMPONENT_ID = unsafeId<ComponentId>('vpb:link');
export const BUTTON_COMPONENT_ID = unsafeId<ComponentId>('vpb:button');

/**
 * The page root.
 *
 * `locked` because deleting the body would leave a page with no tree at all.
 * Every page's tree is rooted at one of these; `createPage` mints it.
 */
export const bodyComponent: ComponentDefinition = {
  id: BODY_COMPONENT_ID,
  label: 'Body',
  category: 'layout',
  tag: 'body',
  children: 'flow',
  props: [],
  locked: true,
  description: 'The page root. Every page has exactly one, and it cannot be deleted.',
};

export const sectionComponent: ComponentDefinition = {
  id: SECTION_COMPONENT_ID,
  label: 'Section',
  category: 'layout',
  tag: 'section',
  children: 'flow',
  props: [],
  description: 'A top-level band of the page.',
};

export const boxComponent: ComponentDefinition = {
  id: BOX_COMPONENT_ID,
  label: 'Box',
  category: 'layout',
  tag: 'div',
  children: 'flow',
  props: [],
  description: 'A generic container. The workhorse for flex and grid layouts.',
};

export const headingComponent: ComponentDefinition = {
  id: HEADING_COMPONENT_ID,
  label: 'Heading',
  category: 'typography',
  tag: 'h2',
  children: 'text',
  props: [
    {
      name: 'text',
      label: 'Text',
      type: 'multiline',
      defaultValue: propString('Heading'),
      required: true,
    },
    {
      /**
       * Level is a PROP, not six separate components, because changing h2 to h3
       * must not destroy the node — a new node would lose its id, and with it
       * every node-scoped style rule (which are keyed by node id) and its place
       * in the tree. The renderer overrides `tag` from this prop; that indirection
       * is exactly what a data-driven registry buys.
       */
      name: 'level',
      label: 'Level',
      type: 'select',
      options: [
        { value: 'h1', label: 'H1' },
        { value: 'h2', label: 'H2' },
        { value: 'h3', label: 'H3' },
        { value: 'h4', label: 'H4' },
        { value: 'h5', label: 'H5' },
        { value: 'h6', label: 'H6' },
      ],
      defaultValue: propString('h2'),
    },
  ],
};

export const textComponent: ComponentDefinition = {
  id: TEXT_COMPONENT_ID,
  label: 'Text',
  category: 'typography',
  tag: 'p',
  children: 'text',
  props: [
    {
      name: 'text',
      label: 'Text',
      type: 'multiline',
      defaultValue: propString('Text'),
      required: true,
    },
  ],
};

export const imageComponent: ComponentDefinition = {
  id: IMAGE_COMPONENT_ID,
  label: 'Image',
  category: 'media',
  tag: 'img',
  children: 'none',
  props: [
    /**
     * `asset`, not `string`. This is the prop model's whole argument in one
     * field: because the src is an AssetId, "delete this asset" can find its
     * usages and the exporter can rewrite the path. See `props.ts`.
     */
    { name: 'src', label: 'Source', type: 'asset', required: true },
    {
      name: 'alt',
      label: 'Alt text',
      type: 'string',
      defaultValue: propString(''),
      description: 'Describes the image for screen readers. Empty means decorative.',
    },
    {
      name: 'lazy',
      label: 'Lazy load',
      type: 'boolean',
      defaultValue: propBoolean(true),
    },
  ],
};

export const linkComponent: ComponentDefinition = {
  id: LINK_COMPONENT_ID,
  label: 'Link',
  category: 'interactive',
  tag: 'a',
  children: 'flow',
  props: [
    { name: 'href', label: 'Link to', type: 'url', required: true },
    {
      name: 'newTab',
      label: 'Open in new tab',
      type: 'boolean',
      defaultValue: propBoolean(false),
    },
  ],
};

export const buttonComponent: ComponentDefinition = {
  id: BUTTON_COMPONENT_ID,
  label: 'Button',
  category: 'interactive',
  tag: 'button',
  children: 'text',
  props: [
    {
      name: 'text',
      label: 'Label',
      type: 'multiline',
      defaultValue: propString('Button'),
      required: true,
    },
    {
      name: 'type',
      label: 'Type',
      type: 'select',
      options: [
        { value: 'button', label: 'Button' },
        { value: 'submit', label: 'Submit' },
        { value: 'reset', label: 'Reset' },
      ],
      defaultValue: propString('button'),
    },
  ],
};

export const BUILTIN_COMPONENTS: readonly ComponentDefinition[] = [
  bodyComponent,
  sectionComponent,
  boxComponent,
  headingComponent,
  textComponent,
  imageComponent,
  linkComponent,
  buttonComponent,
];

/**
 * A function, not a shared constant, because a registry is a value that callers
 * extend — handing every caller the same object invites one test's
 * `registerComponent` result to leak into the next. (The registry is immutable,
 * so this is cheap insurance rather than a correctness fix.)
 */
export function createBuiltinRegistry(): ComponentRegistry {
  return createRegistry(BUILTIN_COMPONENTS);
}
