import type { IdFactory } from '../identity/idFactory.ts';
import type { ClassName, StyleRuleId } from '../identity/ids.ts';
import type { BreakpointSet } from './breakpoints.ts';
import { getBreakpoint } from './breakpoints.ts';
import {
  isEmptyDeclaration,
  setDeclaration,
  unsetDeclaration,
  type StyleDeclaration,
} from './declaration.ts';
import type { StyleProperty } from './properties.ts';
import { scopeKey, type StyleRule, type StyleScope } from './rule.ts';
import { targetKey, type StyleTarget } from './target.ts';
import type { StyleValue } from './values.ts';

/**
 * The stylesheet: every rule in a project, indexed for O(1) access.
 *
 * KEY INVARIANT — at most ONE rule per (scope, target).
 *
 * This is enforced rather than merely hoped for, and it is what makes the whole
 * model tractable. "Set font-size on .btn at Mobile:hover" always addresses
 * exactly one rule, so there is never a question of which of two competing rules
 * a value came from, no duplicate-rule ambiguity to resolve, and no need for
 * source-order tie-breaking within a scope. The resolver's precedence rules can
 * then be about scope/state/breakpoint alone.
 *
 * INDEXING — the prototype re-walked the entire document on every lookup and
 * every edit. Here `index` is scopeKey -> targetKey -> ruleId, maintained
 * incrementally, so both the style panel's read path and the editor's write path
 * are O(1) in the number of rules.
 *
 * IMMUTABILITY — every operation returns a new sheet. The Map copy is O(rules),
 * shallow: a few hundred pointer copies, microseconds. This is categorically
 * different from the prototype's O(nodes) DEEP clone of the whole document per
 * keystroke, and the rules themselves are shared by reference between versions,
 * so it is already structural sharing.
 *
 * An earlier draft of this comment promised that Phase C would "replace even
 * this with immer patches for structural sharing". It does not, because the
 * claim was wrong twice over: immer shallow-copies a Map on write exactly as
 * this does, and immer can only produce fine-grained patches by mutating a
 * draft, which these pure functions never do. Phase C's history is inverse
 * commands — see `@vpb/state/command.ts`, and AUDIT §4.3, which asks for
 * "immer patches / inverse commands" and is satisfied by either.
 */
export interface StyleSheet {
  readonly rules: ReadonlyMap<StyleRuleId, StyleRule>;
  readonly index: ReadonlyMap<string, ReadonlyMap<string, StyleRuleId>>;
  /**
   * WHICH CLASS BEATS WHICH — weakest first. Project-wide, not per element.
   *
   * This is the one place the model is allowed an opinion about class
   * precedence, and it lives here rather than on the node for a reason that only
   * shows up at export. In CSS, `class="btn primary"` and `class="primary btn"`
   * are the SAME element: the attribute's order contributes nothing, and which
   * rule wins is decided by the order the rules appear in the stylesheet. So a
   * model that read precedence off each node's list could express documents no
   * stylesheet can reproduce — two nodes carrying the same classes in opposite
   * orders would each demand a different winner, and one of them would have to
   * render wrong. That is the WYSIWYG invariant broken in the model, before the
   * emitter ever runs.
   *
   * Keeping the order here makes the emitter faithful by construction: it writes
   * class rules in exactly this sequence, and the browser reproduces the
   * resolver's answer for free. `.btn` before `.btn-primary` here means
   * `.btn-primary` wins there, for every element that has both.
   *
   * An element that genuinely needs to disagree has node-local rules, which
   * outrank every class — which is also what a CSS author would reach for.
   */
  readonly classOrder: readonly ClassName[];
}

export const EMPTY_STYLESHEET: StyleSheet = {
  rules: new Map(),
  index: new Map(),
  classOrder: [],
};

export function createStyleSheet(rules: readonly StyleRule[] = []): StyleSheet {
  let sheet = EMPTY_STYLESHEET;
  for (const rule of rules) sheet = putRule(sheet, rule);
  return sheet;
}

export function allRules(sheet: StyleSheet): readonly StyleRule[] {
  return [...sheet.rules.values()];
}

export function ruleCount(sheet: StyleSheet): number {
  return sheet.rules.size;
}

export function getRule(sheet: StyleSheet, id: StyleRuleId): StyleRule | undefined {
  return sheet.rules.get(id);
}

/** O(1). The style panel's hot path. */
export function findRule(
  sheet: StyleSheet,
  scope: StyleScope,
  target: StyleTarget,
): StyleRule | undefined {
  const id = sheet.index.get(scopeKey(scope))?.get(targetKey(target));
  return id === undefined ? undefined : sheet.rules.get(id);
}

/** Every rule for a scope, across all targets. O(rules for that scope). */
export function rulesForScope(sheet: StyleSheet, scope: StyleScope): readonly StyleRule[] {
  const targets = sheet.index.get(scopeKey(scope));
  if (!targets) return [];

  const out: StyleRule[] = [];
  for (const id of targets.values()) {
    const rule = sheet.rules.get(id);
    if (rule) out.push(rule);
  }
  return out;
}

function indexWith(
  index: ReadonlyMap<string, ReadonlyMap<string, StyleRuleId>>,
  scope: StyleScope,
  target: StyleTarget,
  id: StyleRuleId,
): ReadonlyMap<string, ReadonlyMap<string, StyleRuleId>> {
  const sKey = scopeKey(scope);
  const targets = new Map(index.get(sKey) ?? []);
  targets.set(targetKey(target), id);

  const next = new Map(index);
  next.set(sKey, targets);
  return next;
}

function indexWithout(
  index: ReadonlyMap<string, ReadonlyMap<string, StyleRuleId>>,
  scope: StyleScope,
  target: StyleTarget,
): ReadonlyMap<string, ReadonlyMap<string, StyleRuleId>> {
  const sKey = scopeKey(scope);
  const existing = index.get(sKey);
  if (!existing) return index;

  const targets = new Map(existing);
  targets.delete(targetKey(target));

  const next = new Map(index);
  // Drop the scope bucket entirely when it empties, so `scopeKeys` never reports
  // a class that has no rules and the exporter never emits an empty section.
  if (targets.size === 0) next.delete(sKey);
  else next.set(sKey, targets);
  return next;
}

/**
 * Insert or replace the rule at (scope, target).
 *
 * If a different rule already occupies that slot it is EVICTED — the invariant
 * is maintained by construction rather than by callers remembering to check.
 * A rule with empty declarations is dropped rather than stored: otherwise
 * unsetting the last property would leave `.btn:hover {}` in the sheet and in
 * the exported CSS forever.
 */
export function putRule(sheet: StyleSheet, rule: StyleRule): StyleSheet {
  if (isEmptyDeclaration(rule.declarations)) {
    return removeRuleAt(sheet, rule.scope, rule.target);
  }

  const existingId = sheet.index.get(scopeKey(rule.scope))?.get(targetKey(rule.target));

  const rules = new Map(sheet.rules);
  if (existingId !== undefined && existingId !== rule.id) rules.delete(existingId);
  rules.set(rule.id, rule);

  return {
    rules,
    index: indexWith(sheet.index, rule.scope, rule.target, rule.id),
    classOrder: withClass(sheet.classOrder, rule.scope),
  };
}

/**
 * A newly styled class joins the order at the END — the strongest position.
 *
 * It matches what the author just did: they made a class and styled it, and they
 * expect that styling to take effect on the elements they put it on, not to lose
 * silently to a class created last week. It is also what appending a rule to a
 * stylesheet does in CSS.
 */
function withClass(order: readonly ClassName[], scope: StyleScope): readonly ClassName[] {
  if (scope.kind !== 'class' || order.includes(scope.name)) return order;
  return [...order, scope.name];
}

/**
 * Removing a rule does NOT remove its class from the order.
 *
 * Deliberate, and the alternative is a trap. Unsetting a class's last property
 * drops the rule and would drop the class from the order with it — so styling it
 * again would append it at the strongest position, and a property it used to
 * lose it would now win. The cascade would change because of an edit that only
 * ever touched one value, with nothing on screen to explain it. A class with no
 * rules contributes nothing anyway, so keeping the slot costs a string and buys
 * a stable order. `removeScope` is the deliberate delete, and that one does drop it.
 */
export function removeRule(sheet: StyleSheet, id: StyleRuleId): StyleSheet {
  const rule = sheet.rules.get(id);
  if (!rule) return sheet;

  const rules = new Map(sheet.rules);
  rules.delete(id);
  return {
    rules,
    index: indexWithout(sheet.index, rule.scope, rule.target),
    classOrder: sheet.classOrder,
  };
}

export function removeRuleAt(
  sheet: StyleSheet,
  scope: StyleScope,
  target: StyleTarget,
): StyleSheet {
  const id = sheet.index.get(scopeKey(scope))?.get(targetKey(target));
  return id === undefined ? sheet : removeRule(sheet, id);
}

/**
 * Drop every rule for a scope. Called when a class is deleted or a node is
 * removed from the tree — without it, deleting nodes would leak rules forever
 * and the exported CSS would grow with every edit session.
 */
export function removeScope(sheet: StyleSheet, scope: StyleScope): StyleSheet {
  const sKey = scopeKey(scope);
  const targets = sheet.index.get(sKey);
  if (!targets) return sheet;

  const rules = new Map(sheet.rules);
  for (const id of targets.values()) rules.delete(id);

  const index = new Map(sheet.index);
  index.delete(sKey);

  // The deliberate delete, so the class leaves the order too. Contrast
  // `removeRule`, which keeps it.
  const classOrder =
    scope.kind === 'class'
      ? sheet.classOrder.filter((name) => name !== scope.name)
      : sheet.classOrder;

  return { rules, index, classOrder };
}

/**
 * Reorder class precedence outright — the style panel's "which class wins" control.
 *
 * Names not already in the sheet are ignored rather than added: the order is a
 * ranking of classes that exist, and accepting arbitrary names would let a typo
 * silently create one. Existing classes left out of `order` keep their relative
 * position at the end, so a partial reorder cannot quietly drop a class's rank.
 */
export function setClassOrder(sheet: StyleSheet, order: readonly ClassName[]): StyleSheet {
  const known = new Set(sheet.classOrder);
  const ranked: ClassName[] = [];
  for (const name of order) {
    if (known.has(name) && !ranked.includes(name)) ranked.push(name);
  }
  for (const name of sheet.classOrder) {
    if (!ranked.includes(name)) ranked.push(name);
  }
  return { ...sheet, classOrder: ranked };
}

/**
 * Set one property at one (scope, target) — the operation behind every click in
 * the style panel.
 *
 * Creates the rule if it does not exist, which is why an `IdFactory` is needed.
 */
export function setProperty(
  sheet: StyleSheet,
  scope: StyleScope,
  target: StyleTarget,
  property: StyleProperty,
  value: StyleValue,
  ids: IdFactory,
): StyleSheet {
  const existing = findRule(sheet, scope, target);
  const declarations = setDeclaration(existing?.declarations ?? {}, property, value);

  return putRule(sheet, {
    id: existing?.id ?? ids.styleRule(),
    scope,
    target,
    declarations,
  });
}

/**
 * Remove one property. The rule is deleted if it becomes empty.
 *
 * Note this removes the OVERRIDE, not the value: unsetting `padding` at Mobile
 * means Mobile once again inherits whatever Desktop says. That is the point of
 * the cascade, and it is what the prototype could not express at all.
 */
export function unsetProperty(
  sheet: StyleSheet,
  scope: StyleScope,
  target: StyleTarget,
  property: StyleProperty,
): StyleSheet {
  const existing = findRule(sheet, scope, target);
  if (!existing) return sheet;

  const declarations = unsetDeclaration(existing.declarations, property);
  if (declarations === existing.declarations) return sheet;

  return putRule(sheet, { ...existing, declarations });
}

export function setDeclarations(
  sheet: StyleSheet,
  scope: StyleScope,
  target: StyleTarget,
  declarations: StyleDeclaration,
  ids: IdFactory,
): StyleSheet {
  const existing = findRule(sheet, scope, target);
  return putRule(sheet, {
    id: existing?.id ?? ids.styleRule(),
    scope,
    target,
    declarations,
  });
}

/** Every scope that has at least one rule. */
export function scopeKeys(sheet: StyleSheet): readonly string[] {
  return [...sheet.index.keys()];
}

/**
 * Rules pointing at a breakpoint that no longer exists.
 *
 * Deleting a custom breakpoint must not silently delete the styles authored
 * against it — the user may be about to re-add it, and destroying work on a
 * misclick is unforgivable. So rules are kept, become inert (`cascadeChain`
 * skips unknown ids rather than throwing), and are reported here so the settings
 * UI can offer "3 rules reference a deleted breakpoint: remap or delete?".
 */
export function orphanedRules(sheet: StyleSheet, breakpoints: BreakpointSet): readonly StyleRule[] {
  return allRules(sheet).filter((rule) => !getBreakpoint(breakpoints, rule.target.breakpoint));
}

/**
 * Verify the index agrees with the rules it indexes.
 *
 * The index is derived state maintained incrementally, and derived state
 * maintained incrementally drifts. This is called by tests after every mutation
 * so a bug in an index update surfaces where it happened, rather than three
 * phases later as a rule that mysteriously cannot be found.
 */
export function validateStyleSheet(sheet: StyleSheet): readonly string[] {
  const errors: string[] = [];
  const indexed = new Set<StyleRuleId>();

  for (const [sKey, targets] of sheet.index) {
    if (targets.size === 0) errors.push(`Index has an empty bucket for scope "${sKey}".`);

    for (const [tKey, id] of targets) {
      const rule = sheet.rules.get(id);
      if (!rule) {
        errors.push(`Index points at missing rule "${id}" (${sKey} / ${tKey}).`);
        continue;
      }
      if (indexed.has(id)) errors.push(`Rule "${id}" is indexed more than once.`);
      indexed.add(id);

      if (scopeKey(rule.scope) !== sKey) {
        errors.push(
          `Rule "${id}" is indexed under "${sKey}" but its scope is "${scopeKey(rule.scope)}".`,
        );
      }
      if (targetKey(rule.target) !== tKey) {
        errors.push(
          `Rule "${id}" is indexed under "${tKey}" but its target is "${targetKey(rule.target)}".`,
        );
      }
    }
  }

  /*
   * Every styled class must have a rank.
   *
   * A class with rules but no place in `classOrder` is invisible to `scopesFor`,
   * so its rules would silently stop applying — the sheet would look correct,
   * `rules` would contain them, and nothing would render. Checked in one
   * direction only: a rank with no rules is fine and deliberate (see
   * `removeRule`).
   */
  const ranked = new Set(sheet.classOrder);
  for (const rule of sheet.rules.values()) {
    if (rule.scope.kind === 'class' && !ranked.has(rule.scope.name)) {
      errors.push(`Class ".${rule.scope.name}" has rules but no place in classOrder.`);
    }
  }
  if (ranked.size !== sheet.classOrder.length) {
    errors.push('classOrder contains a duplicate, so one class has two ranks.');
  }

  for (const [id, rule] of sheet.rules) {
    if (!indexed.has(id)) errors.push(`Rule "${id}" exists but is not indexed.`);
    if (isEmptyDeclaration(rule.declarations)) errors.push(`Rule "${id}" has no declarations.`);
  }

  return errors;
}
