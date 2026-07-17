import { beforeEach, describe, expect, it } from 'vitest';

import { createDeterministicIdFactory, type IdFactory } from '../../identity/idFactory.ts';
import type { BreakpointId, ClassName, NodeId } from '../../identity/ids.ts';
import { unsafeId } from '../../identity/ids.ts';
import {
  BASE_BREAKPOINT_ID,
  MOBILE_BREAKPOINT_ID,
  TABLET_BREAKPOINT_ID,
  defaultBreakpoints,
} from '../breakpoints.ts';
import {
  isInheritedFromCascade,
  propertySources,
  resolveDeclarations,
  resolveProperty,
  resolveStyle,
  type StyleQuery,
} from '../resolve.ts';
import { classScope, nodeScope } from '../rule.ts';
import { setClassOrder, setProperty, type StyleSheet, EMPTY_STYLESHEET } from '../stylesheet.ts';
import { target } from '../target.ts';
import { px } from '../values.ts';

const C = (v: string) => unsafeId<ClassName>(v);
const N = (v: string) => unsafeId<NodeId>(v);

const BP = defaultBreakpoints();
const BTN = C('btn');
const NODE = N('node-1');

let ids: IdFactory;
beforeEach(() => {
  ids = createDeterministicIdFactory();
});

const query = (classes: ClassName[] = [BTN], nodeId: NodeId | null = NODE): StyleQuery => ({
  classes,
  nodeId,
});

/** Reads the padding value out of a resolution, or undefined. */
const padding = (
  sheet: StyleSheet,
  q: StyleQuery,
  t: ReturnType<typeof target>,
): number | undefined => {
  const resolved = resolveProperty(sheet, q, t, 'paddingTop', BP);
  return resolved?.value.kind === 'length' ? resolved.value.value : undefined;
};

/* -------------------------------------------------------------------------- */
/* Breakpoint cascade — the prototype's second fatal bug                       */
/* -------------------------------------------------------------------------- */

describe('breakpoint cascade', () => {
  /**
   * The headline. `props.styles?.[breakpoint]` returned undefined here and the
   * padding silently vanished when you switched to Mobile.
   */
  it('inherits a base value all the way down to mobile', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );

    expect(padding(sheet, query(), target(BASE_BREAKPOINT_ID))).toBe(40);
    expect(padding(sheet, query(), target(TABLET_BREAKPOINT_ID))).toBe(40);
    expect(padding(sheet, query(), target(MOBILE_BREAKPOINT_ID))).toBe(40);
  });

  it('a narrower breakpoint overrides a wider one', () => {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(MOBILE_BREAKPOINT_ID),
      'paddingTop',
      px(10),
      ids,
    );

    expect(padding(sheet, query(), target(BASE_BREAKPOINT_ID))).toBe(40);
    expect(padding(sheet, query(), target(TABLET_BREAKPOINT_ID))).toBe(40);
    expect(padding(sheet, query(), target(MOBILE_BREAKPOINT_ID))).toBe(10);
  });

  it('an override applies to descendants of the breakpoint that set it', () => {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(TABLET_BREAKPOINT_ID),
      'paddingTop',
      px(20),
      ids,
    );

    // Mobile inherits through mobile-landscape, through tablet.
    expect(padding(sheet, query(), target(MOBILE_BREAKPOINT_ID))).toBe(20);
  });

  it('does not leak a narrow override upward to wider breakpoints', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(MOBILE_BREAKPOINT_ID),
      'paddingTop',
      px(10),
      ids,
    );

    expect(padding(sheet, query(), target(MOBILE_BREAKPOINT_ID))).toBe(10);
    expect(padding(sheet, query(), target(TABLET_BREAKPOINT_ID))).toBeUndefined();
    expect(padding(sheet, query(), target(BASE_BREAKPOINT_ID))).toBeUndefined();
  });

  it('merges different properties from different breakpoints', () => {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(MOBILE_BREAKPOINT_ID),
      'marginTop',
      px(5),
      ids,
    );

    const declarations = resolveDeclarations(sheet, query(), target(MOBILE_BREAKPOINT_ID), BP);
    expect(declarations.paddingTop).toEqual(px(40));
    expect(declarations.marginTop).toEqual(px(5));
  });
});

/* -------------------------------------------------------------------------- */
/* State cascade                                                               */
/* -------------------------------------------------------------------------- */

describe('state cascade', () => {
  /**
   * `:hover` layers on top of the base rule; it does not replace it. Without
   * this, every hover style would have to redundantly restate the entire resting
   * style, and forgetting one property would blank it on hover.
   */
  it('hover inherits the default state underneath it', () => {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID, 'hover'),
      'marginTop',
      px(2),
      ids,
    );

    const hovered = resolveDeclarations(sheet, query(), target(BASE_BREAKPOINT_ID, 'hover'), BP);
    expect(hovered.paddingTop).toEqual(px(40));
    expect(hovered.marginTop).toEqual(px(2));
  });

  it('hover overrides the default value for the same property', () => {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID, 'hover'),
      'paddingTop',
      px(50),
      ids,
    );

    expect(padding(sheet, query(), target(BASE_BREAKPOINT_ID))).toBe(40);
    expect(padding(sheet, query(), target(BASE_BREAKPOINT_ID, 'hover'))).toBe(50);
  });

  it('does not leak hover into the default state', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID, 'hover'),
      'paddingTop',
      px(50),
      ids,
    );
    expect(padding(sheet, query(), target(BASE_BREAKPOINT_ID))).toBeUndefined();
  });

  it('states are independent of each other', () => {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID, 'hover'),
      'paddingTop',
      px(50),
      ids,
    );
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID, 'focus'),
      'paddingTop',
      px(60),
      ids,
    );

    expect(padding(sheet, query(), target(BASE_BREAKPOINT_ID, 'hover'))).toBe(50);
    expect(padding(sheet, query(), target(BASE_BREAKPOINT_ID, 'focus'))).toBe(60);
  });

  /**
   * `:focus-visible` is not `:focus`. Layering them would make mouse-focus styles
   * leak into keyboard-focus styles, breaking one input mode or the other.
   */
  it('focusVisible does not inherit from focus', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID, 'focus'),
      'paddingTop',
      px(60),
      ids,
    );
    expect(padding(sheet, query(), target(BASE_BREAKPOINT_ID, 'focusVisible'))).toBeUndefined();
  });

  it('state and breakpoint cascades compose', () => {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(MOBILE_BREAKPOINT_ID, 'hover'),
      'paddingTop',
      px(8),
      ids,
    );

    // Base default -> inherited at mobile; mobile hover wins when hovered.
    expect(padding(sheet, query(), target(MOBILE_BREAKPOINT_ID))).toBe(40);
    expect(padding(sheet, query(), target(MOBILE_BREAKPOINT_ID, 'hover'))).toBe(8);
  });
});

/* -------------------------------------------------------------------------- */
/* Pseudo-elements                                                             */
/* -------------------------------------------------------------------------- */

describe('pseudo-elements', () => {
  it('are a separate universe from the element itself', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );
    // ::before is its own box; it does not merge the element's own rules.
    expect(
      padding(sheet, query(), target(BASE_BREAKPOINT_ID, 'default', 'before')),
    ).toBeUndefined();
  });

  it('do not leak into the element', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID, 'default', 'before'),
      'paddingTop',
      px(4),
      ids,
    );
    expect(padding(sheet, query(), target(BASE_BREAKPOINT_ID))).toBeUndefined();
    expect(padding(sheet, query(), target(BASE_BREAKPOINT_ID, 'default', 'before'))).toBe(4);
  });

  it('cascade across breakpoints within their own universe', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID, 'default', 'before'),
      'paddingTop',
      px(4),
      ids,
    );
    expect(padding(sheet, query(), target(MOBILE_BREAKPOINT_ID, 'default', 'before'))).toBe(4);
  });

  it('distinguish different pseudo-elements', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID, 'default', 'before'),
      'paddingTop',
      px(4),
      ids,
    );
    expect(padding(sheet, query(), target(BASE_BREAKPOINT_ID, 'default', 'after'))).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Scope precedence                                                            */
/* -------------------------------------------------------------------------- */

describe('scope precedence', () => {
  /** `.btn` styled first, then `.btn-primary` — so the sheet ranks primary stronger. */
  function twoClasses(primary: ClassName) {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );
    sheet = setProperty(
      sheet,
      classScope(primary),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(12),
      ids,
    );
    return sheet;
  }

  it('a class ranked later in the sheet overrides one ranked earlier', () => {
    const primary = C('btn-primary');
    const sheet = twoClasses(primary);

    expect(sheet.classOrder).toEqual([BTN, primary]);
    expect(padding(sheet, query([BTN, primary]), target(BASE_BREAKPOINT_ID))).toBe(12);
  });

  /**
   * THE WYSIWYG INVARIANT, AT THE POINT IT WOULD BREAK.
   *
   * This assertion used to read the other way: the element's list decided, so
   * reversing it reversed the winner. That is not something a stylesheet can
   * reproduce — `class="btn primary"` and `class="primary btn"` are the same
   * element to a browser, and one global source order cannot satisfy two elements
   * that demand opposite winners. The model was more expressive than the platform
   * it exports to, which is an unfixable export hole (AUDIT §4.7) rather than a
   * feature. Precedence now comes from `sheet.classOrder`, and the order the
   * classes are handed in is ignored — exactly as the attribute is.
   */
  it('ignores the order the classes are applied in — the attribute does not rank', () => {
    const primary = C('btn-primary');
    const sheet = twoClasses(primary);

    expect(padding(sheet, query([BTN, primary]), target(BASE_BREAKPOINT_ID))).toBe(12);
    expect(padding(sheet, query([primary, BTN]), target(BASE_BREAKPOINT_ID))).toBe(12);
  });

  it('follows the sheet when the ranking is changed', () => {
    // The user's control over which class wins: reorder the sheet, not the element.
    const primary = C('btn-primary');
    const sheet = setClassOrder(twoClasses(primary), [primary, BTN]);

    expect(padding(sheet, query([BTN, primary]), target(BASE_BREAKPOINT_ID))).toBe(40);
    expect(padding(sheet, query([primary, BTN]), target(BASE_BREAKPOINT_ID))).toBe(40);
  });

  it('a class the sheet has never styled contributes nothing and takes no rank', () => {
    const primary = C('btn-primary');
    const sheet = twoClasses(primary);

    expect(padding(sheet, query([C('ghost'), BTN]), target(BASE_BREAKPOINT_ID))).toBe(40);
  });

  it('node-local overrides every class', () => {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );
    sheet = setProperty(
      sheet,
      nodeScope(NODE),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(99),
      ids,
    );

    expect(padding(sheet, query(), target(BASE_BREAKPOINT_ID))).toBe(99);
  });

  it('a class rule applies to every node carrying the class', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );
    expect(padding(sheet, query([BTN], N('a')), target(BASE_BREAKPOINT_ID))).toBe(40);
    expect(padding(sheet, query([BTN], N('b')), target(BASE_BREAKPOINT_ID))).toBe(40);
  });

  it('a node rule does not leak to other nodes', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      nodeScope(N('a')),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(99),
      ids,
    );
    expect(padding(sheet, query([BTN], N('b')), target(BASE_BREAKPOINT_ID))).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* The precedence order itself                                                 */
/* -------------------------------------------------------------------------- */

describe('precedence: state > scope > breakpoint', () => {
  /**
   * STATE beats SCOPE.
   *
   * A node-local resting colour must not silently strip the class's hover
   * behaviour. If scope dominated, setting any local value on an element would
   * kill every hover it had — the kind of bug users report as "hover randomly
   * stops working".
   *
   * This also matches the browser: `.btn:hover` is (0,2,0) and beats `.n-x`
   * (0,1,0) on specificity alone.
   */
  it('a class hover beats a node-local default', () => {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID, 'hover'),
      'paddingTop',
      px(50),
      ids,
    );
    sheet = setProperty(
      sheet,
      nodeScope(NODE),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(99),
      ids,
    );

    expect(padding(sheet, query(), target(BASE_BREAKPOINT_ID))).toBe(99);
    expect(padding(sheet, query(), target(BASE_BREAKPOINT_ID, 'hover'))).toBe(50);
  });

  it('a node hover still beats a class hover', () => {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID, 'hover'),
      'paddingTop',
      px(50),
      ids,
    );
    sheet = setProperty(
      sheet,
      nodeScope(NODE),
      target(BASE_BREAKPOINT_ID, 'hover'),
      'paddingTop',
      px(7),
      ids,
    );

    expect(padding(sheet, query(), target(BASE_BREAKPOINT_ID, 'hover'))).toBe(7);
  });

  it('a class hover beats a node-local default even at a narrower breakpoint', () => {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID, 'hover'),
      'paddingTop',
      px(50),
      ids,
    );
    sheet = setProperty(
      sheet,
      nodeScope(NODE),
      target(MOBILE_BREAKPOINT_ID),
      'paddingTop',
      px(99),
      ids,
    );

    expect(padding(sheet, query(), target(MOBILE_BREAKPOINT_ID))).toBe(99);
    // State still outranks scope AND breakpoint together.
    expect(padding(sheet, query(), target(MOBILE_BREAKPOINT_ID, 'hover'))).toBe(50);
  });

  it('a later class hover beats an earlier class hover, but neither beats a node hover', () => {
    const primary = C('btn-primary');
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID, 'hover'),
      'paddingTop',
      px(1),
      ids,
    );
    sheet = setProperty(
      sheet,
      classScope(primary),
      target(BASE_BREAKPOINT_ID, 'hover'),
      'paddingTop',
      px(2),
      ids,
    );

    expect(padding(sheet, query([BTN, primary]), target(BASE_BREAKPOINT_ID, 'hover'))).toBe(2);

    sheet = setProperty(
      sheet,
      nodeScope(NODE),
      target(BASE_BREAKPOINT_ID, 'hover'),
      'paddingTop',
      px(3),
      ids,
    );
    expect(padding(sheet, query([BTN, primary]), target(BASE_BREAKPOINT_ID, 'hover'))).toBe(3);
  });

  /**
   * The inverse of the rule above, stated separately so a precedence swap fails
   * loudly in both directions rather than only one.
   */
  it('a node-local default does NOT suppress a class hover on any property', () => {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID, 'hover'),
      'marginTop',
      px(5),
      ids,
    );
    sheet = setProperty(
      sheet,
      nodeScope(NODE),
      target(BASE_BREAKPOINT_ID),
      'marginTop',
      px(1),
      ids,
    );

    const hovered = resolveDeclarations(sheet, query(), target(BASE_BREAKPOINT_ID, 'hover'), BP);
    expect(hovered.marginTop).toEqual(px(5));
  });

  /**
   * SCOPE beats BREAKPOINT.
   *
   * An explicit, element-specific instruction outranks a class's viewport rule.
   * Otherwise a local override would mysteriously evaporate on resize.
   */
  it('a node-local base value beats a class mobile override', () => {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(MOBILE_BREAKPOINT_ID),
      'paddingTop',
      px(10),
      ids,
    );
    sheet = setProperty(
      sheet,
      nodeScope(NODE),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(99),
      ids,
    );

    expect(padding(sheet, query(), target(MOBILE_BREAKPOINT_ID))).toBe(99);
  });

  it('a node mobile override still beats a node base value', () => {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      nodeScope(NODE),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(99),
      ids,
    );
    sheet = setProperty(
      sheet,
      nodeScope(NODE),
      target(MOBILE_BREAKPOINT_ID),
      'paddingTop',
      px(3),
      ids,
    );

    expect(padding(sheet, query(), target(MOBILE_BREAKPOINT_ID))).toBe(3);
  });

  it('the strongest possible combination wins over all others', () => {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(1),
      ids,
    );
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(MOBILE_BREAKPOINT_ID),
      'paddingTop',
      px(2),
      ids,
    );
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(MOBILE_BREAKPOINT_ID, 'hover'),
      'paddingTop',
      px(3),
      ids,
    );
    sheet = setProperty(
      sheet,
      nodeScope(NODE),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(4),
      ids,
    );
    sheet = setProperty(
      sheet,
      nodeScope(NODE),
      target(MOBILE_BREAKPOINT_ID, 'hover'),
      'paddingTop',
      px(5),
      ids,
    );

    expect(padding(sheet, query(), target(MOBILE_BREAKPOINT_ID, 'hover'))).toBe(5);
  });
});

/* -------------------------------------------------------------------------- */
/* Provenance                                                                  */
/* -------------------------------------------------------------------------- */

describe('provenance', () => {
  it('reports which rule won', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );
    const resolved = resolveStyle(sheet, query(), target(MOBILE_BREAKPOINT_ID), BP).get(
      'paddingTop',
    );

    expect(resolved?.rule.scope).toEqual(classScope(BTN));
    expect(resolved?.rule.target.breakpoint).toBe(BASE_BREAKPOINT_ID);
  });

  /**
   * A user who cannot see WHY their value is being ignored concludes the tool is
   * broken. With three competing axes that is not a hypothetical.
   */
  it('lists every contributing rule, weakest first, winner last', () => {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(MOBILE_BREAKPOINT_ID),
      'paddingTop',
      px(10),
      ids,
    );
    sheet = setProperty(
      sheet,
      nodeScope(NODE),
      target(MOBILE_BREAKPOINT_ID),
      'paddingTop',
      px(2),
      ids,
    );

    const sources = propertySources(sheet, query(), target(MOBILE_BREAKPOINT_ID), 'paddingTop', BP);
    expect(sources.map((s) => (s.value.kind === 'length' ? s.value.value : null))).toEqual([
      40, 10, 2,
    ]);
  });

  it('reports no sources for an unset property', () => {
    expect(
      propertySources(EMPTY_STYLESHEET, query(), target(BASE_BREAKPOINT_ID), 'paddingTop', BP),
    ).toEqual([]);
  });

  it('knows a value came from another breakpoint', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      nodeScope(NODE),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );

    expect(
      isInheritedFromCascade(sheet, query([], NODE), target(BASE_BREAKPOINT_ID), 'paddingTop', BP),
    ).toBe(false);
    expect(
      isInheritedFromCascade(
        sheet,
        query([], NODE),
        target(MOBILE_BREAKPOINT_ID),
        'paddingTop',
        BP,
      ),
    ).toBe(true);
  });

  it('knows a value came from a class rather than this element', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );
    expect(
      isInheritedFromCascade(sheet, query(), target(BASE_BREAKPOINT_ID), 'paddingTop', BP),
    ).toBe(true);
  });
});

describe('edge cases', () => {
  it('an empty sheet resolves to nothing', () => {
    expect(
      resolveDeclarations(EMPTY_STYLESHEET, query(), target(MOBILE_BREAKPOINT_ID), BP),
    ).toEqual({});
  });

  it('a query with no classes and no node resolves to nothing', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );
    expect(
      resolveDeclarations(sheet, { classes: [], nodeId: null }, target(BASE_BREAKPOINT_ID), BP),
    ).toEqual({});
  });

  it('a class with no rules contributes nothing', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );
    expect(padding(sheet, query([C('unused')]), target(BASE_BREAKPOINT_ID))).toBeUndefined();
  });

  it('rules against a deleted breakpoint go inert rather than throwing', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(unsafeId<BreakpointId>('ghost')),
      'paddingTop',
      px(40),
      ids,
    );
    expect(() => resolveDeclarations(sheet, query(), target(BASE_BREAKPOINT_ID), BP)).not.toThrow();
    expect(padding(sheet, query(), target(BASE_BREAKPOINT_ID))).toBeUndefined();
  });

  it('a duplicated class in the list is harmless', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID),
      'paddingTop',
      px(40),
      ids,
    );
    expect(padding(sheet, query([BTN, BTN]), target(BASE_BREAKPOINT_ID))).toBe(40);
  });
});
