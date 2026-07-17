import type { ClassName, NodeId, StyleRuleId } from '../identity/ids.ts';
import { unsafeId } from '../identity/ids.ts';
import type { StyleDeclaration } from './declaration.ts';
import type { StyleTarget } from './target.ts';

/**
 * WHO a rule applies to.
 *
 * Two scopes, mirroring how commercial builders actually work:
 *
 *  - `class` — a reusable style. Edit `.btn` and every button changes. This is
 *    the specification's "Reusable Styles" and the foundation of Symbols. It is
 *    also how Webflow works, and the reason its output is a real stylesheet
 *    rather than ten thousand inline attributes.
 *
 *  - `node` — an override on ONE element. The specification's per-element
 *    editing. Compiles to a generated class scoped to that node's id.
 *
 * The prototype had neither: every style was an inline `style=` attribute on a
 * node, which is why it could produce no reusable styles, no design tokens, no
 * media queries, and no hover states.
 */
export type StyleScope =
  | { readonly kind: 'class'; readonly name: ClassName }
  | { readonly kind: 'node'; readonly nodeId: NodeId };

export const classScope = (name: ClassName): StyleScope => ({ kind: 'class', name });
export const nodeScope = (nodeId: NodeId): StyleScope => ({ kind: 'node', nodeId });

export interface StyleRule {
  readonly id: StyleRuleId;
  readonly scope: StyleScope;
  readonly target: StyleTarget;
  readonly declarations: StyleDeclaration;
}

const SCOPE_SEPARATOR = ':';

/** Stable map key for a scope. See `targetKey` for why keys are strings. */
export function scopeKey(scope: StyleScope): string {
  return scope.kind === 'class'
    ? `class${SCOPE_SEPARATOR}${scope.name}`
    : `node${SCOPE_SEPARATOR}${scope.nodeId}`;
}

export function parseScopeKey(key: string): StyleScope | null {
  const index = key.indexOf(SCOPE_SEPARATOR);
  if (index === -1) return null;

  const kind = key.slice(0, index);
  const value = key.slice(index + 1);
  if (value === '') return null;

  if (kind === 'class') return classScope(unsafeId<ClassName>(value));
  if (kind === 'node') return nodeScope(unsafeId<NodeId>(value));
  return null;
}

export function scopesEqual(a: StyleScope, b: StyleScope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'class' && b.kind === 'class') return a.name === b.name;
  if (a.kind === 'node' && b.kind === 'node') return a.nodeId === b.nodeId;
  return false;
}

/**
 * Is this class name safe to emit as a CSS identifier?
 *
 * Class names are USER INPUT — typed into the style panel, or read out of an
 * imported stylesheet. An unchecked name lands directly in a selector, where
 * `btn { } body { display: none } .x` would rewrite the user's whole page, and
 * `btn</style><script>` escapes into HTML when the exporter inlines the CSS.
 *
 * CSS identifiers may contain [A-Za-z0-9_-], must not start with a digit, and
 * must not start with a hyphen followed by a digit. `--` is reserved for custom
 * properties. Escaping would technically permit more, but a page builder has no
 * reason to accept a class name containing a brace, and refusing is a far
 * smaller attack surface than escaping correctly.
 */
export function isValidClassName(name: string): boolean {
  return /^-?[A-Za-z_][A-Za-z0-9_-]*$/.test(name) && !name.startsWith('--');
}
