import { isStyleProperty, type StyleProperty } from './properties.ts';
import type { StyleValue } from './values.ts';

/**
 * A block of declarations: the `{ ... }` of a CSS rule.
 *
 * Deliberately a plain frozen object rather than a Map. It serialises to JSON
 * directly (the project format), it is cheap to spread-merge, and the key space
 * is a closed union rather than arbitrary strings — so the usual reason to reach
 * for a Map (non-string keys, unbounded key space) does not apply.
 */
export type StyleDeclaration = Readonly<Partial<Record<StyleProperty, StyleValue>>>;

export const EMPTY_DECLARATION: StyleDeclaration = Object.freeze({});

export function isEmptyDeclaration(declaration: StyleDeclaration): boolean {
  for (const key in declaration) {
    if (Object.hasOwn(declaration, key)) return false;
  }
  return true;
}

/**
 * Typed iteration.
 *
 * `Object.entries` widens keys to `string`, which would quietly re-open the
 * `Record<string, any>` hole this model exists to close. The `isStyleProperty`
 * filter also drops anything a corrupted project file smuggled in — declarations
 * arrive from JSON, and JSON is untrusted.
 */
export function declarationEntries(
  declaration: StyleDeclaration,
): readonly (readonly [StyleProperty, StyleValue])[] {
  const out: (readonly [StyleProperty, StyleValue])[] = [];
  for (const [key, value] of Object.entries(declaration)) {
    if (isStyleProperty(key) && value !== undefined) out.push([key, value]);
  }
  return out;
}

export function declarationProperties(declaration: StyleDeclaration): readonly StyleProperty[] {
  return declarationEntries(declaration).map(([property]) => property);
}

export function getDeclaration(
  declaration: StyleDeclaration,
  property: StyleProperty,
): StyleValue | undefined {
  return declaration[property];
}

export function setDeclaration(
  declaration: StyleDeclaration,
  property: StyleProperty,
  value: StyleValue,
): StyleDeclaration {
  return { ...declaration, [property]: value };
}

/**
 * Remove a property.
 *
 * Deletes the key rather than setting it to `undefined`. A present-but-undefined
 * key survives a spread and would shadow an inherited value during a merge — the
 * property would read as "explicitly set to nothing" instead of "not set here",
 * which is the difference between a mobile override clearing a desktop value and
 * correctly inheriting it.
 */
export function unsetDeclaration(
  declaration: StyleDeclaration,
  property: StyleProperty,
): StyleDeclaration {
  if (!Object.hasOwn(declaration, property)) return declaration;
  const next: Partial<Record<StyleProperty, StyleValue>> = { ...declaration };
  delete next[property];
  return next;
}

/**
 * Merge, with `override` winning per property.
 *
 * The single primitive the whole cascade is built from: `resolveStyle` is this
 * function applied along an ordered sequence of rules.
 */
export function mergeDeclarations(
  base: StyleDeclaration,
  override: StyleDeclaration,
): StyleDeclaration {
  return { ...base, ...override };
}

/**
 * Structural equality by property presence and value identity.
 *
 * Reference-based, NOT deep: style values are immutable and rebuilt by the
 * constructors on every edit, so an unchanged value is the same reference. This
 * makes the common "did anything change?" check O(number of properties) instead
 * of a deep walk of nested shadows and gradient stops on every keystroke.
 */
export function declarationsEqual(a: StyleDeclaration, b: StyleDeclaration): boolean {
  const aEntries = declarationEntries(a);
  const bEntries = declarationEntries(b);
  if (aEntries.length !== bEntries.length) return false;
  for (const [property, value] of aEntries) {
    if (b[property] !== value) return false;
  }
  return true;
}
