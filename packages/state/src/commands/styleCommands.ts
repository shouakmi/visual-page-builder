import type {
  IdFactory,
  StyleProperty,
  StyleRuleId,
  StyleScope,
  StyleTarget,
  StyleValue,
} from '@vpb/core';
import {
  acceptsValue,
  findRule,
  getDeclaration,
  scopeKey,
  setProperty,
  targetKey,
  unsetProperty,
} from '@vpb/core';

import type { Command } from '../command.ts';
import { refuse, succeed } from '../command.ts';
import type { EditorState } from '../editorState.ts';

/**
 * Style commands — the style panel's write path.
 *
 * These are the commands that made the prototype's history unusable. AUDIT §4.3:
 * `updateCss` called `commit` on every character typed, and each entry was a full
 * deep clone of the document. So these are also the commands that carry a
 * `coalesceKey`: a slider drag or a typed length is one user intention, and it
 * must cost one history entry, not one per frame.
 */

/**
 * The key identifies WHAT is being edited, never the value.
 *
 * Dragging one slider coalesces because every step shares this key; moving to the
 * next property does not, because the key changes. Including the value would
 * defeat the entire mechanism — every step would be its own entry, which is
 * exactly the bug.
 */
function styleCoalesceKey(scope: StyleScope, target: StyleTarget, property: StyleProperty): string {
  return `setStyleProperty:${scopeKey(scope)}:${targetKey(target)}:${property}`;
}

/**
 * An `IdFactory` that yields one pre-minted rule id and refuses everything else.
 *
 * `setProperty` needs a factory because it mints a `StyleRuleId` when no rule
 * exists for the (scope, target) yet. Handing it a real factory would mean
 * minting inside `apply`, and a redone command would build a rule with a
 * different id than the original.
 *
 * The other seven methods throw rather than delegate, which turns this into an
 * executable assertion: if `setProperty` ever mints anything other than a rule
 * id, the suite says so immediately instead of silently minting a stray node.
 *
 * A rule id is safe to pre-mint where a `NodeId` would not be safe to re-mint,
 * and the difference is worth stating: rules are addressed through the
 * `(scope, target)` index, so nothing outside the sheet holds a `StyleRuleId`.
 * A `NodeId` is referenced by the selection, by node-scoped rules, and by props.
 */
function fixedStyleRuleId(id: StyleRuleId): IdFactory {
  const refuseKind = (kind: string) => (): never => {
    throw new Error(`A style command must not mint a ${kind} id.`);
  };

  return {
    styleRule: () => id,
    node: refuseKind('node'),
    page: refuseKind('page'),
    project: refuseKind('project'),
    breakpoint: refuseKind('breakpoint'),
    token: refuseKind('token'),
    asset: refuseKind('asset'),
    component: refuseKind('component'),
  };
}

/**
 * Set one property on one (scope, target).
 *
 * `ruleId` is consumed only if no rule exists for that scope and target yet;
 * updating an existing rule keeps its id. The caller mints it up front — see
 * `fixedStyleRuleId`.
 */
export function setStylePropertyCommand(
  scope: StyleScope,
  target: StyleTarget,
  property: StyleProperty,
  value: StyleValue,
  ruleId: StyleRuleId,
): Command {
  return {
    kind: 'setStyleProperty',
    label: `Set ${property}`,
    coalesceKey: styleCoalesceKey(scope, target, property),
    apply(state) {
      if (!acceptsValue(property, value)) {
        return refuse(`${property} does not accept a ${value.kind} value.`);
      }

      const styles = state.project.styles;
      const existing = findRule(styles, scope, target);
      const previous = existing && getDeclaration(existing.declarations, property);

      const next: EditorState = {
        ...state,
        project: {
          ...state.project,
          styles: setProperty(styles, scope, target, property, value, fixedStyleRuleId(ruleId)),
        },
      };

      /*
       * NOT CHECKED: setting a property to the value it already has.
       *
       * It should be refused — an entry whose undo restores the same value is an
       * undo the user cannot see, and an invisible Ctrl+Z gets pressed twice,
       * costing a real edit. It is not refused because there is no way to ask
       * the question: `StyleValue` has no structural equality in @vpb/core, and
       * `declarationsEqual` compares values by REFERENCE, so a fresh `px(100)`
       * never equals the stored `px(100)`. A reference check here would be dead
       * code that reads as a working guard.
       *
       * The realistic case is absorbed by `coalesceKey`: a jittering slider is
       * one entry whose undo goes back to the pre-drag value, which is visible.
       * What survives is deliberately re-setting the same value later. Fixing it
       * properly means `valuesEqual` in core — see HANDOFF.
       */

      return succeed(
        next,
        previous === undefined
          ? unsetStylePropertyCommand(scope, target, property)
          : setStylePropertyCommand(scope, target, property, previous, ruleId),
      );
    },
  };
}

/** One property and the value to set it to, for the plural command below. */
export interface StyleDeclarationInput {
  readonly property: StyleProperty;
  readonly value: StyleValue;
}

/** A property and the value it held before an edit — `undefined` when it was unset. */
interface PriorDeclaration {
  readonly property: StyleProperty;
  readonly value: StyleValue | undefined;
}

function stylePropertiesCoalesceKey(
  scope: StyleScope,
  target: StyleTarget,
  declarations: readonly StyleDeclarationInput[],
): string {
  // The properties, sorted, so the key is stable across a gesture whatever order
  // they arrive in — and DISTINCT from a gesture editing a different set, which is
  // a separate intention and must not merge into this one.
  const properties = declarations
    .map((declaration) => declaration.property)
    .slice()
    .sort()
    .join(',');
  return `setStyleProperties:${scopeKey(scope)}:${targetKey(target)}:${properties}`;
}

/**
 * Set SEVERAL properties on one (scope, target) as ONE history entry.
 *
 * A corner resize sets width AND height, and that is one user intention: one undo
 * must put both back. Two `setStylePropertyCommand`s would be two coalesce keys and
 * so two entries, and Ctrl+Z would restore the height but not the width — a half-
 * undone box. This is the minimal answer; Phase E4's `batchCommand` composite,
 * which spans MULTIPLE nodes, is the general one and lands with multi-select ops.
 *
 * The inverse restores every property to exactly what it was, `unset` included, so
 * an undo of a resize on a box that had no explicit size returns it to auto sizing
 * rather than pinning it at its measured pixels.
 */
export function setStylePropertiesCommand(
  scope: StyleScope,
  target: StyleTarget,
  declarations: readonly StyleDeclarationInput[],
  ruleId: StyleRuleId,
): Command {
  return {
    kind: 'setStyleProperties',
    label: `Set ${declarations.map((declaration) => declaration.property).join(', ')}`,
    coalesceKey: stylePropertiesCoalesceKey(scope, target, declarations),
    apply(state) {
      for (const { property, value } of declarations) {
        if (!acceptsValue(property, value)) {
          return refuse(`${property} does not accept a ${value.kind} value.`);
        }
      }

      // Read every prior value BEFORE any write — one `setProperty` can create the
      // rule the next one reads, so the pre-edit picture only exists up front.
      const existing = findRule(state.project.styles, scope, target);
      const priors: PriorDeclaration[] = declarations.map(({ property }) => ({
        property,
        value: existing ? getDeclaration(existing.declarations, property) : undefined,
      }));

      let styles = state.project.styles;
      for (const { property, value } of declarations) {
        styles = setProperty(styles, scope, target, property, value, fixedStyleRuleId(ruleId));
      }

      const next: EditorState = {
        ...state,
        project: { ...state.project, styles },
      };
      return succeed(next, restoreStyleDeclarationsCommand(scope, target, priors, ruleId));
    },
  };
}

/**
 * The inverse of `setStylePropertiesCommand`: put a set of properties back to the
 * values they held, restoring `unset` as an unset rather than a stored value.
 *
 * Private because it is only ever a recorded inverse; it recomputes its own inverse
 * from the state at apply time (symmetric with `setStyleProperties`), so undo/redo
 * chains through it without history holding a stale forward value.
 */
function restoreStyleDeclarationsCommand(
  scope: StyleScope,
  target: StyleTarget,
  priors: readonly PriorDeclaration[],
  ruleId: StyleRuleId,
): Command {
  return {
    kind: 'restoreStyleDeclarations',
    label: `Restore ${priors.map((prior) => prior.property).join(', ')}`,
    apply(state) {
      const existing = findRule(state.project.styles, scope, target);
      const forward: PriorDeclaration[] = priors.map(({ property }) => ({
        property,
        value: existing ? getDeclaration(existing.declarations, property) : undefined,
      }));

      let styles = state.project.styles;
      for (const { property, value } of priors) {
        styles =
          value === undefined
            ? unsetProperty(styles, scope, target, property)
            : setProperty(styles, scope, target, property, value, fixedStyleRuleId(ruleId));
      }

      const next: EditorState = {
        ...state,
        project: { ...state.project, styles },
      };
      return succeed(next, restoreStyleDeclarationsCommand(scope, target, forward, ruleId));
    },
  };
}

/**
 * Remove one property from one (scope, target).
 *
 * Core drops the whole rule when its last property goes, so undoing this can have
 * to recreate the rule — and the inverse hands back the rule's OWN id, read at
 * apply time, so an undo restores the rule that was there rather than a lookalike
 * with a new identity.
 */
export function unsetStylePropertyCommand(
  scope: StyleScope,
  target: StyleTarget,
  property: StyleProperty,
): Command {
  return {
    kind: 'unsetStyleProperty',
    label: `Clear ${property}`,
    apply(state) {
      const styles = state.project.styles;
      const existing = findRule(styles, scope, target);
      if (!existing) return refuse(`${property} is not set here.`);

      const previous = getDeclaration(existing.declarations, property);
      if (previous === undefined) return refuse(`${property} is not set here.`);

      const next: EditorState = {
        ...state,
        project: {
          ...state.project,
          styles: unsetProperty(styles, scope, target, property),
        },
      };

      // Reuse the rule's own id when restoring, so an undo puts back the rule
      // that was there rather than a lookalike with a new identity.
      return succeed(next, setStylePropertyCommand(scope, target, property, previous, existing.id));
    },
  };
}
