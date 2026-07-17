import { beforeEach, describe, expect, it } from 'vitest';

import { createDeterministicIdFactory, type IdFactory } from '../../identity/idFactory.ts';
import type { BreakpointId, ClassName, NodeId, StyleRuleId } from '../../identity/ids.ts';
import { unsafeId } from '../../identity/ids.ts';
import type { StyleRule } from '../rule.ts';
import type { StyleSheet } from '../stylesheet.ts';
import { BASE_BREAKPOINT_ID, MOBILE_BREAKPOINT_ID, defaultBreakpoints } from '../breakpoints.ts';
import { classScope, nodeScope } from '../rule.ts';
import {
  EMPTY_STYLESHEET,
  allRules,
  createStyleSheet,
  findRule,
  getRule,
  orphanedRules,
  putRule,
  removeRule,
  removeRuleAt,
  removeScope,
  ruleCount,
  rulesForScope,
  scopeKeys,
  setClassOrder,
  setDeclarations,
  setProperty,
  unsetProperty,
  validateStyleSheet,
} from '../stylesheet.ts';
import { target } from '../target.ts';
import { px } from '../values.ts';

const C = (v: string) => unsafeId<ClassName>(v);
const N = (v: string) => unsafeId<NodeId>(v);

const BTN = C('btn');
const NODE = N('node-1');
const BASE = target(BASE_BREAKPOINT_ID);
const MOBILE = target(MOBILE_BREAKPOINT_ID);
const BASE_HOVER = target(BASE_BREAKPOINT_ID, 'hover');

let ids: IdFactory;
beforeEach(() => {
  ids = createDeterministicIdFactory();
});

/**
 * The index is derived state maintained incrementally, and derived state
 * maintained incrementally drifts. Asserting the invariant after EVERY mutation
 * means an index bug surfaces at the operation that caused it, not three phases
 * later as a rule that mysteriously cannot be found.
 */
const expectConsistent = (sheet: Parameters<typeof validateStyleSheet>[0]) => {
  expect(validateStyleSheet(sheet)).toEqual([]);
};

describe('setProperty', () => {
  it('creates a rule', () => {
    const sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(40), ids);
    expect(ruleCount(sheet)).toBe(1);
    expect(findRule(sheet, classScope(BTN), BASE)?.declarations.paddingTop).toEqual(px(40));
    expectConsistent(sheet);
  });

  /**
   * THE KEY INVARIANT: at most one rule per (scope, target). Without it, "set
   * font-size on .btn at Mobile" becomes ambiguous — which of the two competing
   * rules did it mean? — and the resolver would need source-order tie-breaking
   * within a scope on top of the three axes it already has.
   */
  it('reuses the existing rule for the same (scope, target)', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(40), ids);
    const firstId = findRule(sheet, classScope(BTN), BASE)?.id;

    sheet = setProperty(sheet, classScope(BTN), BASE, 'marginTop', px(8), ids);

    expect(ruleCount(sheet)).toBe(1);
    expect(findRule(sheet, classScope(BTN), BASE)?.id).toBe(firstId);
    expect(findRule(sheet, classScope(BTN), BASE)?.declarations).toEqual({
      paddingTop: px(40),
      marginTop: px(8),
    });
    expectConsistent(sheet);
  });

  it('creates separate rules for different targets', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(40), ids);
    sheet = setProperty(sheet, classScope(BTN), MOBILE, 'paddingTop', px(10), ids);
    sheet = setProperty(sheet, classScope(BTN), BASE_HOVER, 'paddingTop', px(50), ids);

    expect(ruleCount(sheet)).toBe(3);
    expectConsistent(sheet);
  });

  it('creates separate rules for different scopes', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(40), ids);
    sheet = setProperty(sheet, nodeScope(NODE), BASE, 'paddingTop', px(99), ids);

    expect(ruleCount(sheet)).toBe(2);
    expectConsistent(sheet);
  });

  it('overwrites the same property', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(40), ids);
    sheet = setProperty(sheet, classScope(BTN), BASE, 'paddingTop', px(41), ids);

    expect(ruleCount(sheet)).toBe(1);
    expect(findRule(sheet, classScope(BTN), BASE)?.declarations.paddingTop).toEqual(px(41));
  });

  it('does not mutate the input sheet', () => {
    const before = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(40), ids);
    const after = setProperty(before, classScope(BTN), BASE, 'marginTop', px(8), ids);

    expect(before).not.toBe(after);
    expect(findRule(before, classScope(BTN), BASE)?.declarations.marginTop).toBeUndefined();
    expect(EMPTY_STYLESHEET.rules.size).toBe(0);
  });
});

describe('unsetProperty', () => {
  it('removes one property but keeps the rule', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(40), ids);
    sheet = setProperty(sheet, classScope(BTN), BASE, 'marginTop', px(8), ids);
    sheet = unsetProperty(sheet, classScope(BTN), BASE, 'paddingTop');

    expect(findRule(sheet, classScope(BTN), BASE)?.declarations).toEqual({ marginTop: px(8) });
    expectConsistent(sheet);
  });

  /**
   * Otherwise `.btn:hover {}` accumulates in the sheet and in the exported CSS
   * forever — one empty rule per property the user ever tried and undid.
   */
  it('deletes the rule when its last property is removed', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(40), ids);
    sheet = unsetProperty(sheet, classScope(BTN), BASE, 'paddingTop');

    expect(ruleCount(sheet)).toBe(0);
    expect(findRule(sheet, classScope(BTN), BASE)).toBeUndefined();
    expect(scopeKeys(sheet)).toEqual([]);
    expectConsistent(sheet);
  });

  it('is a no-op for a property that was never set', () => {
    const sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(40), ids);
    expect(unsetProperty(sheet, classScope(BTN), BASE, 'marginTop')).toBe(sheet);
  });

  it('is a no-op for a rule that does not exist', () => {
    expect(unsetProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop')).toBe(
      EMPTY_STYLESHEET,
    );
  });
});

describe('putRule', () => {
  it('evicts a different rule occupying the same slot', () => {
    const sheet = createStyleSheet([
      {
        id: ids.styleRule(),
        scope: classScope(BTN),
        target: BASE,
        declarations: { paddingTop: px(1) },
      },
      {
        id: ids.styleRule(),
        scope: classScope(BTN),
        target: BASE,
        declarations: { paddingTop: px(2) },
      },
    ]);

    expect(ruleCount(sheet)).toBe(1);
    expect(findRule(sheet, classScope(BTN), BASE)?.declarations.paddingTop).toEqual(px(2));
    expectConsistent(sheet);
  });

  it('drops a rule with no declarations rather than storing it', () => {
    const sheet = putRule(EMPTY_STYLESHEET, {
      id: ids.styleRule(),
      scope: classScope(BTN),
      target: BASE,
      declarations: {},
    });
    expect(ruleCount(sheet)).toBe(0);
    expectConsistent(sheet);
  });

  it('an empty declaration set removes an existing rule at that slot', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(40), ids);
    sheet = setDeclarations(sheet, classScope(BTN), BASE, {}, ids);

    expect(ruleCount(sheet)).toBe(0);
    expectConsistent(sheet);
  });
});

describe('removal', () => {
  it('removes by id', () => {
    const sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(40), ids);
    const id = findRule(sheet, classScope(BTN), BASE)!.id;

    const after = removeRule(sheet, id);
    expect(getRule(after, id)).toBeUndefined();
    expect(findRule(after, classScope(BTN), BASE)).toBeUndefined();
    expectConsistent(after);
  });

  it('removing an unknown id is a no-op', () => {
    expect(removeRule(EMPTY_STYLESHEET, unsafeId<StyleRuleId>('nope'))).toBe(EMPTY_STYLESHEET);
  });

  it('removes by slot', () => {
    const sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(40), ids);
    expectConsistent(removeRuleAt(sheet, classScope(BTN), BASE));
    expect(ruleCount(removeRuleAt(sheet, classScope(BTN), BASE))).toBe(0);
  });

  /**
   * Without this, deleting a node leaks its rules forever and the exported CSS
   * grows with every edit session.
   */
  it('removes every rule for a scope', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, nodeScope(NODE), BASE, 'paddingTop', px(1), ids);
    sheet = setProperty(sheet, nodeScope(NODE), MOBILE, 'paddingTop', px(2), ids);
    sheet = setProperty(sheet, nodeScope(NODE), BASE_HOVER, 'paddingTop', px(3), ids);
    sheet = setProperty(sheet, classScope(BTN), BASE, 'paddingTop', px(4), ids);

    const after = removeScope(sheet, nodeScope(NODE));

    expect(ruleCount(after)).toBe(1);
    expect(rulesForScope(after, nodeScope(NODE))).toEqual([]);
    expect(rulesForScope(after, classScope(BTN))).toHaveLength(1);
    expectConsistent(after);
  });

  it('removing an unknown scope is a no-op', () => {
    expect(removeScope(EMPTY_STYLESHEET, classScope(BTN))).toBe(EMPTY_STYLESHEET);
  });
});

describe('lookup', () => {
  it('finds nothing in an empty sheet', () => {
    expect(findRule(EMPTY_STYLESHEET, classScope(BTN), BASE)).toBeUndefined();
    expect(rulesForScope(EMPTY_STYLESHEET, classScope(BTN))).toEqual([]);
  });

  it('lists rules for a scope across targets', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(1), ids);
    sheet = setProperty(sheet, classScope(BTN), MOBILE, 'paddingTop', px(2), ids);

    expect(rulesForScope(sheet, classScope(BTN))).toHaveLength(2);
  });

  it('does not confuse a class and a node with the same name', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(C('x')), BASE, 'paddingTop', px(1), ids);
    sheet = setProperty(sheet, nodeScope(N('x')), BASE, 'paddingTop', px(2), ids);

    expect(ruleCount(sheet)).toBe(2);
    expect(findRule(sheet, classScope(C('x')), BASE)?.declarations.paddingTop).toEqual(px(1));
    expect(findRule(sheet, nodeScope(N('x')), BASE)?.declarations.paddingTop).toEqual(px(2));
    expectConsistent(sheet);
  });

  it('allRules returns every rule', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(1), ids);
    sheet = setProperty(sheet, nodeScope(NODE), MOBILE, 'paddingTop', px(2), ids);
    expect(allRules(sheet)).toHaveLength(2);
  });
});

/**
 * Deleting a custom breakpoint must not silently destroy the styles authored
 * against it — the user may be about to re-add it, and losing work on a misclick
 * is unforgivable. Rules survive, go inert, and get reported here.
 */
describe('orphanedRules', () => {
  it('reports rules pointing at a deleted breakpoint', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(1), ids);
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(unsafeId<BreakpointId>('ghost')),
      'paddingTop',
      px(2),
      ids,
    );

    const orphans = orphanedRules(sheet, defaultBreakpoints());
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.target.breakpoint).toBe('ghost');
  });

  it('reports none for a healthy sheet', () => {
    const sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(1), ids);
    expect(orphanedRules(sheet, defaultBreakpoints())).toEqual([]);
  });
});

describe('validateStyleSheet', () => {
  it('passes a healthy sheet', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(1), ids);
    sheet = setProperty(sheet, nodeScope(NODE), MOBILE, 'marginTop', px(2), ids);
    expect(validateStyleSheet(sheet)).toEqual([]);
  });

  /** The guard must be able to fail, or it is decoration. */
  it('catches a rule that is not indexed', () => {
    const orphan: StyleRule = {
      id: unsafeId<StyleRuleId>('r1'),
      scope: classScope(BTN),
      target: BASE,
      declarations: { paddingTop: px(1) },
    };
    const broken: StyleSheet = {
      rules: new Map([[orphan.id, orphan]]),
      index: new Map(),
      classOrder: [BTN],
    };
    expect(validateStyleSheet(broken).join(' ')).toMatch(/not indexed/i);
  });

  it('catches an index entry pointing at a missing rule', () => {
    const broken: StyleSheet = {
      rules: new Map(),
      index: new Map([['class:btn', new Map([['base|default|', unsafeId<StyleRuleId>('gone')]])]]),
      classOrder: [BTN],
    };
    expect(validateStyleSheet(broken).join(' ')).toMatch(/missing rule/i);
  });

  it('catches a rule indexed under the wrong scope', () => {
    const rule: StyleRule = {
      id: unsafeId<StyleRuleId>('r1'),
      scope: classScope(BTN),
      target: BASE,
      declarations: { paddingTop: px(1) },
    };
    const broken: StyleSheet = {
      rules: new Map([[rule.id, rule]]),
      index: new Map([['class:other', new Map([['base|default|', rule.id]])]]),
      classOrder: [BTN],
    };
    expect(validateStyleSheet(broken).join(' ')).toMatch(/its scope is/i);
  });

  it('catches a styled class with no place in classOrder', () => {
    // Invisible to `scopesFor`, so its rules would silently stop applying: the
    // sheet looks right, `rules` holds them, and nothing renders.
    const rule: StyleRule = {
      id: unsafeId<StyleRuleId>('r1'),
      scope: classScope(BTN),
      target: BASE,
      declarations: { paddingTop: px(1) },
    };
    const broken: StyleSheet = {
      rules: new Map([[rule.id, rule]]),
      index: new Map([['class:btn', new Map([['base|default|', rule.id]])]]),
      classOrder: [],
    };
    expect(validateStyleSheet(broken).join(' ')).toMatch(/no place in classOrder/i);
  });

  it('catches a duplicate rank', () => {
    expect(validateStyleSheet({ ...EMPTY_STYLESHEET, classOrder: [BTN, BTN] }).join(' ')).toMatch(
      /duplicate/i,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* classOrder — which class beats which                                        */
/* -------------------------------------------------------------------------- */

describe('classOrder', () => {
  const PRIMARY = C('btn-primary');

  it('ranks a newly styled class last, i.e. strongest', () => {
    // What the author just did: they made a class and styled it, and expect that
    // styling to take effect rather than lose to one made last week.
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(1), ids);
    sheet = setProperty(sheet, classScope(PRIMARY), BASE, 'paddingTop', px(2), ids);

    expect(sheet.classOrder).toEqual([BTN, PRIMARY]);
  });

  it('ranks a class once, however many rules it gets', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(1), ids);
    sheet = setProperty(sheet, classScope(BTN), BASE, 'paddingBottom', px(2), ids);
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(MOBILE_BREAKPOINT_ID),
      'paddingTop',
      px(3),
      ids,
    );

    expect(sheet.classOrder).toEqual([BTN]);
  });

  it('does not rank node scopes', () => {
    const sheet = setProperty(EMPTY_STYLESHEET, nodeScope(NODE), BASE, 'paddingTop', px(1), ids);
    expect(sheet.classOrder).toEqual([]);
  });

  /**
   * THE TRAP THIS AVOIDS. If unsetting a class's last property dropped its rank,
   * styling it again would append it at the strongest position — so a property it
   * used to lose it would now win, because of an edit that only touched one value.
   */
  it('keeps a class ranked when its last rule is removed', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(1), ids);
    sheet = setProperty(sheet, classScope(PRIMARY), BASE, 'paddingTop', px(2), ids);
    expect(sheet.classOrder).toEqual([BTN, PRIMARY]);

    sheet = unsetProperty(sheet, classScope(BTN), BASE, 'paddingTop');
    expect(rulesForScope(sheet, classScope(BTN))).toEqual([]);
    expect(sheet.classOrder).toEqual([BTN, PRIMARY]);

    // Restyling it does not promote it past .btn-primary.
    sheet = setProperty(sheet, classScope(BTN), BASE, 'paddingTop', px(9), ids);
    expect(sheet.classOrder).toEqual([BTN, PRIMARY]);
  });

  it('drops the rank on removeScope, the deliberate delete', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(1), ids);
    sheet = setProperty(sheet, classScope(PRIMARY), BASE, 'paddingTop', px(2), ids);

    sheet = removeScope(sheet, classScope(BTN));
    expect(sheet.classOrder).toEqual([PRIMARY]);
    expect(validateStyleSheet(sheet)).toEqual([]);
  });
});

describe('setClassOrder', () => {
  const PRIMARY = C('btn-primary');

  function twoClasses() {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(1), ids);
    sheet = setProperty(sheet, classScope(PRIMARY), BASE, 'paddingTop', px(2), ids);
    return sheet;
  }

  it('reorders precedence', () => {
    const sheet = setClassOrder(twoClasses(), [PRIMARY, BTN]);
    expect(sheet.classOrder).toEqual([PRIMARY, BTN]);
    expect(validateStyleSheet(sheet)).toEqual([]);
  });

  it('ignores names the sheet has never styled, so a typo cannot create one', () => {
    const sheet = setClassOrder(twoClasses(), [C('ghost'), PRIMARY, BTN]);
    expect(sheet.classOrder).toEqual([PRIMARY, BTN]);
  });

  it('keeps omitted classes rather than dropping their rank', () => {
    // A partial reorder must not silently unrank a class and take its rules
    // out of the cascade.
    const sheet = setClassOrder(twoClasses(), [PRIMARY]);
    expect(sheet.classOrder).toEqual([PRIMARY, BTN]);
    expect(validateStyleSheet(sheet)).toEqual([]);
  });

  it('ignores a duplicate rather than ranking a class twice', () => {
    const sheet = setClassOrder(twoClasses(), [PRIMARY, PRIMARY, BTN]);
    expect(sheet.classOrder).toEqual([PRIMARY, BTN]);
  });
});
