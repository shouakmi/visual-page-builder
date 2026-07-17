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
