import {
  getAsset,
  getProp,
  isSafeUrl,
  nodeClassName,
  BODY_COMPONENT_ID,
  BOX_COMPONENT_ID,
  BUTTON_COMPONENT_ID,
  HEADING_COMPONENT_ID,
  IMAGE_COMPONENT_ID,
  LINK_COMPONENT_ID,
  SECTION_COMPONENT_ID,
  TEXT_COMPONENT_ID,
  type AssetLibrary,
  type ComponentDefinition,
  type ComponentId,
  type ComponentRegistry,
  type Node,
  type PropValue,
} from '@vpb/core';
import { createElement, type ReactNode } from 'react';

/**
 * THE RENDERERS — one per component, and the reason the canvas is not an XSS hole.
 *
 * AUDIT §4.5, "the renderer is an XSS vector": the prototype interpolated props
 * and text raw into an HTML string, so any quote in user text broke the markup
 * and any `<script>` executed. That is not a bug that gets fixed by escaping
 * more carefully — it is what string concatenation *is*. React builds elements,
 * so text is text and an attribute is an attribute; there is no grammar for a
 * value to escape out of. The suite asserts it, but the property is structural.
 *
 * ─────────────────── A MAP, NOT A SWITCH ───────────────────
 *
 * AUDIT §7.1 calls the hardcoded `NodeType` union "the single most consequential
 * missing abstraction": it was switched on by hand in the renderer AND the
 * exporter, so adding a component meant editing three files, and a plugin could
 * add none at all — you cannot extend someone else's compile-time union.
 *
 * So this is a `ComponentId -> renderer` Map, extended rather than edited. A
 * plugin ships its definition and its renderer together and registers both; no
 * file in this package changes. `ComponentDefinition` carries no `render`
 * function because @vpb/core is framework-free and must run where React does not
 * — the map lives per host, which is this file.
 *
 * Most components need nothing but their `tag`, and `defaultRenderer` covers
 * them. The rest are here because a prop has to become something a generic mapper
 * could not guess: `newTab` is `target` AND `rel`, `lazy` is `loading`, `level`
 * replaces the tag outright.
 */

/** What a renderer is handed. Everything it needs, already resolved. */
export interface NodeRenderContext {
  readonly node: Node;
  readonly definition: ComponentDefinition;
  /**
   * `n-<id> btn btn-primary` — the node's own class plus its references.
   *
   * `n-<id>` is the compiler's half of the deal: `compileStyleSheet` emits node
   * rules as `.n-<id>`, so this is what makes them apply. If the two ever
   * disagree the canvas silently loses every node-local style.
   */
  readonly className: string;
  /** Rendered child nodes. Empty for `text` and `none` child policies. */
  readonly children: ReactNode;
  readonly env: RenderEnvironment;
}

export type NodeRenderer = (ctx: NodeRenderContext) => ReactNode;
export type RendererMap = ReadonlyMap<ComponentId, NodeRenderer>;

export interface RenderEnvironment {
  readonly registry: ComponentRegistry;
  readonly renderers: RendererMap;
  /** Resolves an `asset` prop to something the host can load. */
  readonly assets: AssetLibrary;
}

/* ---------------------------------------------------------------- helpers */

const stringProp = (node: Node, name: string): string | undefined => {
  const value: PropValue | undefined = getProp(node.props, name);
  return value?.kind === 'string' ? value.value : undefined;
};

const booleanProp = (node: Node, name: string): boolean | undefined => {
  const value: PropValue | undefined = getProp(node.props, name);
  return value?.kind === 'boolean' ? value.value : undefined;
};

/**
 * A `url` prop, or `undefined` when it is not safe to navigate to.
 *
 * `javascript:` in an `href` is script execution on click — the same hole as
 * §4.5's, wearing an attribute instead of a tag. `isSafeUrl` already answers
 * this for the exporter and the style serialiser; using it here rather than a
 * second check is what keeps the canvas and the export from disagreeing about
 * what is safe.
 */
const urlProp = (node: Node, name: string): string | undefined => {
  const value: PropValue | undefined = getProp(node.props, name);
  if (value?.kind !== 'url') return undefined;
  return isSafeUrl(value.href) ? value.href : undefined;
};

/** The class list an element carries: its node class, then its references. */
export function classNameFor(node: Node): string {
  return [nodeClassName(node.id), ...node.classes].join(' ');
}

/* -------------------------------------------------------------- renderers */

/**
 * Tag plus children. Covers every component whose props do not become attributes.
 *
 * Also the fallback for an unknown component, so a project referencing a plugin
 * that is not installed renders an empty box rather than crashing the canvas —
 * see `renderNode`.
 */
export const defaultRenderer: NodeRenderer = ({ definition, className, children }) =>
  createElement(definition.tag, { className }, children);

/** `text` prop as the element's only child. */
const textRenderer: NodeRenderer = ({ node, definition, className }) =>
  createElement(definition.tag, { className }, stringProp(node, 'text') ?? '');

/**
 * Heading. `level` REPLACES the tag.
 *
 * `builtins.ts` explains why level is a prop and not six components: changing h2
 * to h3 must not destroy the node, because a new node would lose its id and with
 * it every node-scoped rule keyed to it. "The renderer overrides `tag` from this
 * prop; that indirection is exactly what a data-driven registry buys." This is
 * that override.
 *
 * The value is checked against the definition's own options rather than trusted:
 * it arrives from a persisted file, and `createElement(userString)` would emit
 * whatever tag the file asked for.
 */
const headingRenderer: NodeRenderer = ({ node, definition, className }) => {
  const level = stringProp(node, 'level');
  const allowed = definition.props
    .find((prop) => prop.name === 'level')
    ?.options?.map((option) => option.value);

  const tag = level !== undefined && allowed?.includes(level) ? level : definition.tag;
  return createElement(tag, { className }, stringProp(node, 'text') ?? '');
};

/**
 * Image. The `asset` prop is the whole argument for the prop model.
 *
 * `src` is an `AssetId`, so it is resolved through the library here rather than
 * being a lookalike string — which is what makes "which nodes use this asset?"
 * answerable at all. An unresolved asset renders WITHOUT a src rather than with
 * an empty one: `src=""` re-requests the current page in some browsers.
 *
 * `width`/`height` come from the asset because the browser cannot reserve space
 * before the image loads without them, and the page reflows as it arrives — the
 * reason `Asset` records them at upload.
 */
const imageRenderer: NodeRenderer = ({ node, definition, className, env }) => {
  const value: PropValue | undefined = getProp(node.props, 'src');
  const asset = value?.kind === 'asset' ? getAsset(env.assets, value.id) : undefined;
  const safeSrc = asset && isSafeUrl(asset.src) ? asset.src : undefined;

  return createElement(definition.tag, {
    className,
    ...(safeSrc === undefined ? {} : { src: safeSrc }),
    alt: stringProp(node, 'alt') ?? '',
    ...(booleanProp(node, 'lazy') === true ? { loading: 'lazy' as const } : {}),
    ...(asset?.width === undefined ? {} : { width: asset.width }),
    ...(asset?.height === undefined ? {} : { height: asset.height }),
  });
};

/**
 * Link. `newTab` becomes `target` AND `rel`.
 *
 * `rel="noopener noreferrer"` is not decoration: without `noopener` the opened
 * page gets a handle on this one through `window.opener` and can navigate it
 * somewhere else. Pairing them here means a user who ticks a checkbox cannot ship
 * that hole, which is the point of the prop being a boolean rather than raw
 * attributes.
 */
const linkRenderer: NodeRenderer = ({ node, definition, className, children }) => {
  const href = urlProp(node, 'href');
  const newTab = booleanProp(node, 'newTab') === true;

  return createElement(
    definition.tag,
    {
      className,
      ...(href === undefined ? {} : { href }),
      ...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
    },
    children,
  );
};

/** Button. `type` guarded against its own options, as with heading's level. */
const buttonRenderer: NodeRenderer = ({ node, definition, className }) => {
  const type = stringProp(node, 'type');
  const allowed = definition.props
    .find((prop) => prop.name === 'type')
    ?.options?.map((option) => option.value);

  return createElement(
    definition.tag,
    {
      className,
      type: type !== undefined && allowed?.includes(type) ? type : 'button',
    },
    stringProp(node, 'text') ?? '',
  );
};

/**
 * The builtin renderers.
 *
 * A function rather than a shared constant, for the same reason
 * `createBuiltinRegistry` is: a Map is a value callers extend, and handing every
 * caller the same one invites a plugin's registration to leak between hosts.
 */
export function createBuiltinRenderers(): RendererMap {
  return new Map<ComponentId, NodeRenderer>([
    [BODY_COMPONENT_ID, defaultRenderer],
    [SECTION_COMPONENT_ID, defaultRenderer],
    [BOX_COMPONENT_ID, defaultRenderer],
    [HEADING_COMPONENT_ID, headingRenderer],
    [TEXT_COMPONENT_ID, textRenderer],
    [IMAGE_COMPONENT_ID, imageRenderer],
    [LINK_COMPONENT_ID, linkRenderer],
    [BUTTON_COMPONENT_ID, buttonRenderer],
  ]);
}
