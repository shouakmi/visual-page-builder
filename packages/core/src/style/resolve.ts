import type { ClassName, NodeId } from '../identity/ids.ts';
import { cascadeChain, type BreakpointSet } from './breakpoints.ts';
import { declarationEntries, type StyleDeclaration } from './declaration.ts';
import type { StyleProperty } from './properties.ts';
import { classScope, nodeScope, type StyleRule, type StyleScope } from './rule.ts';
import { findRule, type StyleSheet } from './stylesheet.ts';
import { stateLayers, type StyleTarget } from './target.ts';
import type { StyleValue } from './values.ts';

/**
 * THE CASCADE RESOLVER.
 *
 * Answers: "given this element's classes, what does it actually look like at
 * this breakpoint, in this state?"
 *
 * ────────────────────────── PRECEDENCE ──────────────────────────
 *
 * Three axes compete. Strongest first:
 *
 *   1. STATE       default  <  hover / focus / ...
 *   2. SCOPE       class[0] < class[1] < ... < node-local
 *   3. BREAKPOINT  base     < tablet < mobile-landscape < mobile
 *
 * Read as nested loops with the strongest axis OUTERMOST, merging as we go: the
 * last write wins, so the axis that changes most slowly dominates.
 *
 * WHY THIS ORDER, defended axis by axis:
 *
 *   STATE over SCOPE. A node-local `color: blue` must NOT kill the class's
 *   `:hover { color: red }`. The user set a resting colour on one element; they
 *   did not ask to strip that element's hover behaviour. Making scope dominant
 *   would silently break every hover on every locally-tweaked element.
 *
 *   SCOPE over BREAKPOINT. If `.btn` says `padding: 10px` at Mobile and the user
 *   explicitly set `padding: 30px` on THIS element at Desktop (base), the local
 *   value wins at every width. An explicit, element-specific instruction outranks
 *   a class's viewport rule; the alternative is a local override that mysteriously
 *   evaporates when you resize.
 *
 * ──────────────────── AND WHY IT COSTS NOTHING ───────────────────
 *
 * This precedence is EXACTLY what a browser produces from source-ordered CSS —
 * which means Phase D's emitter needs no `@layer`, no `!important`, and no
 * specificity hacks. Emitting in the same nesting reproduces it for free:
 *
 *   `:hover` adds a class-level specificity (0,2,0 vs 0,1,0), so state wins on
 *   specificity regardless of order. Media queries add NO specificity, so within
 *   a state block, source order alone decides — and emitting class rules before
 *   node rules, each with base before narrower breakpoints, yields precisely the
 *   sequence below.
 *
 * A model that agrees with the platform by construction cannot drift from it.
 * That is the WYSIWYG invariant, established here rather than patched later.
 */

/** The style-relevant identity of an element. */
export interface StyleQuery {
  /** Applied classes, weakest first. Order is the user's; later overrides earlier. */
  readonly classes: readonly ClassName[];
  /** `null` for a query not bound to a specific element (e.g. previewing a class). */
  readonly nodeId: NodeId | null;
}

export interface ResolvedProperty {
  readonly value: StyleValue;
  /** The rule that won. Powers "inherited from .btn on Desktop" in the panel. */
  readonly rule: StyleRule;
}

export type ResolvedStyle = ReadonlyMap<StyleProperty, ResolvedProperty>;

/**
 * The scopes contributing to a query, weakest first.
 *
 * Node-local last, so it outranks every class — within its state layer.
 */
function scopesFor(query: StyleQuery): readonly StyleScope[] {
  const scopes: StyleScope[] = query.classes.map(classScope);
  if (query.nodeId !== null) scopes.push(nodeScope(query.nodeId));
  return scopes;
}

/**
 * The full ordered sequence of rules contributing to a target, weakest first.
 *
 * Extracted because both `resolveStyle` and `propertySources` need the identical
 * ordering, and two implementations of a precedence rule is one too many.
 */
function contributingRules(
  sheet: StyleSheet,
  query: StyleQuery,
  target: StyleTarget,
  breakpoints: BreakpointSet,
): readonly StyleRule[] {
  const scopes = scopesFor(query);
  const chain = cascadeChain(breakpoints, target.breakpoint);
  const rules: StyleRule[] = [];

  // Strongest axis outermost. See the precedence note above.
  for (const state of stateLayers(target.state)) {
    for (const scope of scopes) {
      for (const breakpoint of chain) {
        const rule = findRule(sheet, scope, {
          breakpoint: breakpoint.id,
          state,
          // Pseudo-elements are a separate universe: `::before` is its own box
          // and does not merge with the element's own rules. Only same-pseudo
          // rules contribute.
          pseudo: target.pseudo,
        });
        if (rule) rules.push(rule);
      }
    }
  }

  return rules;
}

/**
 * Resolve an element's effective style, with provenance.
 *
 * Returns the winning value per property AND the rule it came from — the panel
 * needs the latter to show "set on .btn at Desktop" and to know whether editing
 * here creates an override or edits the original.
 */
export function resolveStyle(
  sheet: StyleSheet,
  query: StyleQuery,
  target: StyleTarget,
  breakpoints: BreakpointSet,
): ResolvedStyle {
  const resolved = new Map<StyleProperty, ResolvedProperty>();

  for (const rule of contributingRules(sheet, query, target, breakpoints)) {
    for (const [property, value] of declarationEntries(rule.declarations)) {
      resolved.set(property, { value, rule });
    }
  }

  return resolved;
}

/** The effective declarations, without provenance. What the compiler wants. */
export function resolveDeclarations(
  sheet: StyleSheet,
  query: StyleQuery,
  target: StyleTarget,
  breakpoints: BreakpointSet,
): StyleDeclaration {
  const out: Partial<Record<StyleProperty, StyleValue>> = {};
  for (const [property, { value }] of resolveStyle(sheet, query, target, breakpoints)) {
    out[property] = value;
  }
  return out;
}

export function resolveProperty(
  sheet: StyleSheet,
  query: StyleQuery,
  target: StyleTarget,
  property: StyleProperty,
  breakpoints: BreakpointSet,
): ResolvedProperty | undefined {
  return resolveStyle(sheet, query, target, breakpoints).get(property);
}

/**
 * Every rule that sets a property, weakest first — the winner is last.
 *
 * This is what lets the style panel show a value as struck-through and
 * "overridden by .btn-primary at Mobile" instead of just silently not applying.
 * In a system with three competing axes, a user who cannot see WHY their value
 * is being ignored will conclude the tool is broken. Webflow ships this for
 * exactly that reason.
 */
export function propertySources(
  sheet: StyleSheet,
  query: StyleQuery,
  target: StyleTarget,
  property: StyleProperty,
  breakpoints: BreakpointSet,
): readonly ResolvedProperty[] {
  const sources: ResolvedProperty[] = [];

  for (const rule of contributingRules(sheet, query, target, breakpoints)) {
    const value = rule.declarations[property];
    if (value !== undefined) sources.push({ value, rule });
  }

  return sources;
}

/**
 * Is this property's value at this target inherited from elsewhere in the
 * cascade, rather than set here?
 *
 * Drives the panel's "this value comes from Desktop" affordance — the difference
 * between editing the Desktop value and creating a Mobile override, which is the
 * single most confusing moment in any responsive builder.
 */
export function isInheritedFromCascade(
  sheet: StyleSheet,
  query: StyleQuery,
  target: StyleTarget,
  property: StyleProperty,
  breakpoints: BreakpointSet,
): boolean {
  const winner = resolveProperty(sheet, query, target, property, breakpoints);
  if (!winner) return false;

  const { rule } = winner;
  return (
    rule.target.breakpoint !== target.breakpoint ||
    rule.target.state !== target.state ||
    (query.nodeId !== null && rule.scope.kind !== 'node')
  );
}
