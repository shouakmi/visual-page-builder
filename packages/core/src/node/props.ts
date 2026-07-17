import type { AssetId } from '../identity/ids.ts';

/**
 * A node's non-style content: an image's source, a link's href, a heading's
 * level, a button's label.
 *
 * STRUCTURED, NOT `any`. The prototype typed props as `Record<string, any>`
 * (AUDIT §3.1) and paid for it twice over: the props panel could not know what
 * editor to render for a prop it had never seen, and an image's `src` was an
 * indistinguishable string. That second point is the expensive one — with a bare
 * string there is no way to answer "which nodes use this asset?", so deleting an
 * asset silently breaks pages, and an exporter cannot rewrite asset paths on the
 * way out. `referencedAssets` below is only possible because an asset reference
 * is a distinct KIND.
 *
 * This is the same lesson the style model learned from style-as-string, applied
 * to the other half of the document. The shape mirrors `StyleValue` deliberately:
 * one union, one `kind` discriminant, constructor per kind.
 *
 * Deliberately much smaller than `StyleValue` (5 kinds vs 14) because props carry
 * no cascade, no units, and no functional syntax — a prop is a leaf.
 */
export type PropValue =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'asset'; readonly id: AssetId }
  | { readonly kind: 'url'; readonly href: string };

export type PropValueKind = PropValue['kind'];

/**
 * Named `propString` rather than `string` because `@vpb/core`'s barrel already
 * exports `str`, `number`, and `url` from the style value vocabulary. Two
 * `number` constructors meaning different things in one import statement is a
 * bug waiting to be written.
 */
export const propString = (value: string): PropValue => ({ kind: 'string', value });
export const propNumber = (value: number): PropValue => ({ kind: 'number', value });
export const propBoolean = (value: boolean): PropValue => ({ kind: 'boolean', value });
export const propAsset = (id: AssetId): PropValue => ({ kind: 'asset', id });
export const propUrl = (href: string): PropValue => ({ kind: 'url', href });

/** A node's props, keyed by `PropDefinition.name`. */
export type PropValues = Readonly<Record<string, PropValue>>;

export const EMPTY_PROPS: PropValues = {};

/**
 * What editor the props panel renders, and what a value must satisfy.
 *
 * `string` vs `multiline` and `url` vs `string` carry the same runtime type; they
 * differ in what the panel shows (input vs textarea) and how the exporter treats
 * them (an href is resolved against the site root, a caption is not). Collapsing
 * them to "string" would push that knowledge into per-component special cases in
 * the panel — exactly the hardcoded switch the registry exists to delete.
 */
export type PropType = 'string' | 'multiline' | 'number' | 'boolean' | 'select' | 'url' | 'asset';

export interface PropOption {
  readonly value: string;
  readonly label: string;
}

export interface PropDefinition {
  readonly name: string;
  readonly label: string;
  readonly type: PropType;
  /** Required for `select`, meaningless otherwise. */
  readonly options?: readonly PropOption[];
  readonly defaultValue?: PropValue;
  /**
   * A node missing a required prop is incomplete, not invalid — a freshly
   * dropped Image has no `src` until the user picks one. `validateProps` reports
   * it so the panel can prompt; it does not block the insert.
   */
  readonly required?: boolean;
  readonly description?: string;
}

/** Does a value satisfy a declared type? */
export function acceptsPropValue(definition: PropDefinition, value: PropValue): boolean {
  switch (definition.type) {
    case 'string':
    case 'multiline':
      return value.kind === 'string';
    case 'number':
      return value.kind === 'number';
    case 'boolean':
      return value.kind === 'boolean';
    case 'url':
      return value.kind === 'url';
    case 'asset':
      return value.kind === 'asset';
    case 'select':
      // A select's value must be one of its declared options. Without this check
      // a stale project file could carry `variant: "ghsot"` and the renderer
      // would fall through every branch and emit an unstyled element.
      return (
        value.kind === 'string' && (definition.options ?? []).some((o) => o.value === value.value)
      );
  }
}

export function getProp(props: PropValues, name: string): PropValue | undefined {
  return props[name];
}

export function setProp(props: PropValues, name: string, value: PropValue): PropValues {
  return { ...props, [name]: value };
}

export function unsetProp(props: PropValues, name: string): PropValues {
  if (!(name in props)) return props;

  const next = { ...props };
  delete next[name];
  return next;
}

/**
 * Read a prop as a plain string, or `undefined` if absent or another kind.
 *
 * The renderer and exporter want `"hero.png"`, not a union to switch on, at every
 * single call site. `asset` returns its id: callers resolving an asset to a URL
 * need the project's asset table, which core does not have — see
 * `referencedAssets` for the tracking path.
 */
export function propToString(value: PropValue | undefined): string | undefined {
  if (!value) return undefined;

  switch (value.kind) {
    case 'string':
      return value.value;
    case 'url':
      return value.href;
    case 'asset':
      return value.id;
    case 'number':
      return String(value.value);
    case 'boolean':
      return String(value.value);
  }
}

/**
 * Every asset referenced by a set of props.
 *
 * The whole reason `PropValue` is a union. Asset deletion, "find usages", export
 * bundling, and broken-link detection all reduce to this function — and none of
 * them are expressible if `src` is just a string.
 */
export function referencedAssets(props: PropValues): readonly AssetId[] {
  const out: AssetId[] = [];
  for (const value of Object.values(props)) {
    if (value.kind === 'asset' && !out.includes(value.id)) out.push(value.id);
  }
  return out;
}

export function propsEqual(a: PropValues, b: PropValues): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;

  return aKeys.every((key) => {
    const av = a[key];
    const bv = b[key];
    if (!av || !bv || av.kind !== bv.kind) return false;

    switch (av.kind) {
      case 'asset':
        return av.id === (bv as { id: AssetId }).id;
      case 'url':
        return av.href === (bv as { href: string }).href;
      default:
        return av.value === (bv as { value: unknown }).value;
    }
  });
}
