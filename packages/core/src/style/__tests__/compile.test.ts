import { beforeEach, describe, expect, it } from 'vitest';

import { createDeterministicIdFactory, type IdFactory } from '../../identity/idFactory.ts';
import type { ClassName, NodeId } from '../../identity/ids.ts';
import { unsafeId } from '../../identity/ids.ts';
import {
  BASE_BREAKPOINT_ID,
  MOBILE_BREAKPOINT_ID,
  TABLET_BREAKPOINT_ID,
  defaultBreakpoints,
} from '../breakpoints.ts';
import { compileStyleSheet, nodeClassName, ruleSelector } from '../compile.ts';
import { propertySources } from '../resolve.ts';
import { classScope, nodeScope } from '../rule.ts';
import { EMPTY_STYLESHEET, setClassOrder, setProperty } from '../stylesheet.ts';
import { target } from '../target.ts';
import { hex } from '../color.ts';
import { color, keyword, px, token } from '../values.ts';

const C = (v: string) => unsafeId<ClassName>(v);
const N = (v: string) => unsafeId<NodeId>(v);

const BTN = C('btn');
const PRIMARY = C('btn-primary');
const NODE = N('a7Kd93Bx2Qmz');
const BP = defaultBreakpoints();
const BASE = target(BASE_BREAKPOINT_ID);

let ids: IdFactory;
beforeEach(() => {
  ids = createDeterministicIdFactory();
});

describe('nodeClassName', () => {
  it('prefixes the id, because a CSS identifier may not start with a digit', () => {
    expect(nodeClassName(N('9abc'))).toBe('n-9abc');
  });
});

describe('ruleSelector', () => {
  it('compiles a class scope', () => {
    expect(ruleSelector(classScope(BTN), BASE)).toBe('.btn');
  });

  it('compiles a node scope to a CLASS, not an id selector', () => {
    // An #id selector is (1,0,0) and would outrank every class at every
    // breakpoint -- `.btn:hover` would lose to a node's resting colour. As a
    // class it sits at (0,1,0), so SOURCE ORDER decides and precedence stays in
    // the emitter's hands.
    expect(ruleSelector(nodeScope(NODE), BASE)).toBe('.n-a7Kd93Bx2Qmz');
  });

  it('appends the state', () => {
    expect(ruleSelector(classScope(BTN), target(BASE_BREAKPOINT_ID, 'hover'))).toBe('.btn:hover');
  });

  it('appends the pseudo-element after the state', () => {
    expect(ruleSelector(classScope(BTN), target(BASE_BREAKPOINT_ID, 'hover', 'before'))).toBe(
      '.btn:hover::before',
    );
  });
});

describe('compileStyleSheet', () => {
  it('emits nothing for an empty sheet', () => {
    expect(compileStyleSheet(EMPTY_STYLESHEET, BP)).toBe('');
  });

  it('emits a rule with its declarations', () => {
    const sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(10), ids);
    expect(compileStyleSheet(sheet, BP)).toBe('.btn {\n  padding-top: 10px;\n}');
  });

  it('uses the CSS property name, not the model name', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      BASE,
      'backgroundColor',
      color(hex('#ff0000')),
      ids,
    );
    expect(compileStyleSheet(sheet, BP)).toContain('background-color:');
  });

  it('wraps a non-base breakpoint in its media query', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(MOBILE_BREAKPOINT_ID),
      'paddingTop',
      px(4),
      ids,
    );

    const css = compileStyleSheet(sheet, BP);
    expect(css).toContain('@media (max-width: 479px) {');
    expect(css).toContain('.btn {');
  });

  it('emits base without a media query', () => {
    const sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(10), ids);
    expect(compileStyleSheet(sheet, BP)).not.toContain('@media');
  });

  it('resolves tokens through the injected context', () => {
    const sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      BASE,
      'color',
      token(unsafeId('brand'), color(hex('#000000'))),
      ids,
    );

    const css = compileStyleSheet(sheet, BP, {
      serialize: { tokenVar: (id) => (id === 'brand' ? 'vpb-brand' : null) },
    });
    expect(css).toContain('var(--vpb-brand');
  });
});

/* -------------------------------------------------------------------------- */
/* Emission order — where the WYSIWYG invariant is won or lost                 */
/* -------------------------------------------------------------------------- */

describe('emission order', () => {
  const orderOf = (css: string, ...needles: string[]): number[] =>
    needles.map((needle) => css.indexOf(needle));

  const ascending = (positions: readonly number[]): boolean =>
    positions.every((p, i) => p !== -1 && (i === 0 || p > (positions[i - 1] as number)));

  it('emits classes in the sheet ranking, so a later class wins on source order', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(10), ids);
    sheet = setProperty(sheet, classScope(PRIMARY), BASE, 'paddingTop', px(20), ids);

    expect(ascending(orderOf(compileStyleSheet(sheet, BP), '.btn {', '.btn-primary {'))).toBe(true);
  });

  it('follows a reordered ranking', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(10), ids);
    sheet = setProperty(sheet, classScope(PRIMARY), BASE, 'paddingTop', px(20), ids);
    sheet = setClassOrder(sheet, [PRIMARY, BTN]);

    expect(ascending(orderOf(compileStyleSheet(sheet, BP), '.btn-primary {', '.btn {'))).toBe(true);
  });

  /**
   * SCOPE BEATS BREAKPOINT, and this is the assertion that proves the emitter
   * bought it with order alone.
   *
   * A media query adds no specificity, so `.n-x` emitted AFTER `@media { .btn }`
   * wins at every width — which is what the resolver says: an explicit
   * element-level value must not evaporate when you resize.
   */
  it('emits every class rule, media queries included, before any node rule', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(10), ids);
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(MOBILE_BREAKPOINT_ID),
      'paddingTop',
      px(4),
      ids,
    );
    sheet = setProperty(sheet, nodeScope(NODE), BASE, 'paddingTop', px(30), ids);

    const css = compileStyleSheet(sheet, BP);
    expect(
      ascending(orderOf(css, '.btn {', '@media (max-width: 479px)', '.n-a7Kd93Bx2Qmz {')),
    ).toBe(true);
  });

  it('emits breakpoints parents-first within a scope', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(10), ids);
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(MOBILE_BREAKPOINT_ID),
      'paddingTop',
      px(4),
      ids,
    );
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(TABLET_BREAKPOINT_ID),
      'paddingTop',
      px(8),
      ids,
    );

    const css = compileStyleSheet(sheet, BP);
    expect(ascending(orderOf(css, '.btn {', '(max-width: 991px)', '(max-width: 479px)'))).toBe(
      true,
    );
  });

  it('emits the resting style before its state layer', () => {
    let sheet = setProperty(
      EMPTY_STYLESHEET,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID, 'hover'),
      'paddingTop',
      px(20),
      ids,
    );
    sheet = setProperty(sheet, classScope(BTN), BASE, 'paddingTop', px(10), ids);

    expect(ascending(orderOf(compileStyleSheet(sheet, BP), '.btn {', '.btn:hover {'))).toBe(true);
  });
});

describe('node filtering', () => {
  const OTHER = N('bbbb');

  function twoNodes() {
    let sheet = setProperty(EMPTY_STYLESHEET, nodeScope(NODE), BASE, 'paddingTop', px(1), ids);
    sheet = setProperty(sheet, nodeScope(OTHER), BASE, 'paddingTop', px(2), ids);
    return sheet;
  }

  it('emits every node rule when no filter is given', () => {
    const css = compileStyleSheet(twoNodes(), BP);
    expect(css).toContain('.n-a7Kd93Bx2Qmz');
    expect(css).toContain('.n-bbbb');
  });

  it('emits only the named nodes — a page must not carry another page rules', () => {
    const css = compileStyleSheet(twoNodes(), BP, { nodes: new Set([NODE]) });
    expect(css).toContain('.n-a7Kd93Bx2Qmz');
    expect(css).not.toContain('.n-bbbb');
  });

  it('never filters classes, which are project-wide', () => {
    let sheet = twoNodes();
    sheet = setProperty(sheet, classScope(BTN), BASE, 'paddingTop', px(9), ids);

    expect(compileStyleSheet(sheet, BP, { nodes: new Set() })).toContain('.btn {');
  });
});

/* -------------------------------------------------------------------------- */
/* THE WYSIWYG INVARIANT                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The compiler and the resolver must rank the same rules the same way.
 *
 * This is the invariant Phase D exists to establish, and it can be checked
 * without a browser. `propertySources` returns every rule contributing to a
 * property "weakest first — the winner is last": the resolver's precedence, made
 * public for the style panel. The browser, reading the compiled CSS, decides
 * between those same rules by source order wherever specificity ties.
 *
 * So: for any element, the sequence `propertySources` reports must be the
 * sequence in which those rules appear in the CSS. If it is, the last rule the
 * resolver prefers is also the last one the browser sees, and the two agree.
 * If it is not, the canvas and the export disagree — AUDIT §4.7 — and this test
 * says which rule moved.
 *
 * The one axis this cannot cover is STATE, which the browser settles on
 * specificity rather than order (`.btn:hover` is (0,2,0)). That is asserted
 * separately, above, by emitting node scopes as classes so nothing else reaches
 * (0,2,0) by accident.
 */
describe('the compiler agrees with the resolver', () => {
  const positionsOf = (css: string, selectors: readonly string[]): number[] =>
    selectors.map((selector) => css.indexOf(`${selector} {`));

  /** Assert the resolver's ranking of a property matches the CSS source order. */
  function expectAgreement(
    sheet: ReturnType<typeof setProperty>,
    query: { classes: readonly ClassName[]; nodeId: NodeId | null },
    at: ReturnType<typeof target>,
    property: 'paddingTop',
  ) {
    const css = compileStyleSheet(sheet, BP);
    const sources = propertySources(sheet, query, at, property, BP);

    // Only the rules that tie on specificity are settled by order; the state
    // layers are settled by the browser regardless. Compare within one state.
    const sameState = sources.filter((s) => s.rule.target.state === at.state);
    const selectors = sameState.map((s) => ruleSelector(s.rule.scope, s.rule.target));
    const positions = positionsOf(css, selectors);

    expect(
      positions.every((p) => p !== -1),
      `every contributing rule is in the CSS: ${selectors}`,
    ).toBe(true);
    expect(
      [...positions].sort((a, b) => a - b),
      `resolver ranks ${selectors.join(' < ')}; CSS must emit them in that order`,
    ).toEqual(positions);
  }

  it('agrees when two classes compete', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(10), ids);
    sheet = setProperty(sheet, classScope(PRIMARY), BASE, 'paddingTop', px(20), ids);

    expectAgreement(sheet, { classes: [BTN, PRIMARY], nodeId: null }, BASE, 'paddingTop');
    // The element's order is irrelevant to both sides, which is the point.
    expectAgreement(sheet, { classes: [PRIMARY, BTN], nodeId: null }, BASE, 'paddingTop');
  });

  it('agrees after the ranking is reordered', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(10), ids);
    sheet = setProperty(sheet, classScope(PRIMARY), BASE, 'paddingTop', px(20), ids);
    sheet = setClassOrder(sheet, [PRIMARY, BTN]);

    expectAgreement(sheet, { classes: [BTN, PRIMARY], nodeId: null }, BASE, 'paddingTop');
  });

  it('agrees when a class media rule competes with a node base rule', () => {
    // The case that decides scope-over-breakpoint. The node rule is emitted after
    // the media block, so the browser prefers it at every width -- as the
    // resolver does.
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(10), ids);
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(MOBILE_BREAKPOINT_ID),
      'paddingTop',
      px(4),
      ids,
    );
    sheet = setProperty(sheet, nodeScope(NODE), BASE, 'paddingTop', px(30), ids);

    expectAgreement(
      sheet,
      { classes: [BTN], nodeId: NODE },
      target(MOBILE_BREAKPOINT_ID),
      'paddingTop',
    );
  });

  it('agrees across the whole breakpoint chain', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(10), ids);
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(TABLET_BREAKPOINT_ID),
      'paddingTop',
      px(8),
      ids,
    );
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(MOBILE_BREAKPOINT_ID),
      'paddingTop',
      px(4),
      ids,
    );

    expectAgreement(
      sheet,
      { classes: [BTN], nodeId: null },
      target(MOBILE_BREAKPOINT_ID),
      'paddingTop',
    );
  });

  it('agrees for a node competing with two classes at once', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(10), ids);
    sheet = setProperty(sheet, classScope(PRIMARY), BASE, 'paddingTop', px(20), ids);
    sheet = setProperty(sheet, nodeScope(NODE), BASE, 'paddingTop', px(30), ids);

    expectAgreement(sheet, { classes: [BTN, PRIMARY], nodeId: NODE }, BASE, 'paddingTop');
  });
});

/* -------------------------------------------------------------------------- */
/* Golden file — AUDIT §8 asks for these by name                              */
/* -------------------------------------------------------------------------- */

describe('golden output', () => {
  /**
   * A whole realistic sheet, written out.
   *
   * The per-assertion tests above each check one rule of the emitter; this checks
   * that they compose into the document a browser actually reads. It is
   * deliberately brittle: if this diff surprises you, the cascade changed and the
   * question is whether the model changed with it.
   */
  it('compiles a representative sheet exactly', () => {
    let sheet = setProperty(EMPTY_STYLESHEET, classScope(BTN), BASE, 'paddingTop', px(12), ids);
    sheet = setProperty(sheet, classScope(BTN), BASE, 'display', keyword('flex'), ids);
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(BASE_BREAKPOINT_ID, 'hover'),
      'color',
      color(hex('#ff0000')),
      ids,
    );
    sheet = setProperty(
      sheet,
      classScope(BTN),
      target(MOBILE_BREAKPOINT_ID),
      'paddingTop',
      px(6),
      ids,
    );
    sheet = setProperty(sheet, classScope(PRIMARY), BASE, 'color', color(hex('#0000ff')), ids);
    sheet = setProperty(sheet, nodeScope(NODE), BASE, 'paddingTop', px(30), ids);

    expect(compileStyleSheet(sheet, BP)).toBe(
      [
        '.btn {',
        '  padding-top: 12px;',
        '  display: flex;',
        '}',
        '',
        '.btn:hover {',
        '  color: #ff0000;',
        '}',
        '',
        '@media (max-width: 479px) {',
        '  .btn {',
        '    padding-top: 6px;',
        '  }',
        '}',
        '',
        '.btn-primary {',
        '  color: #0000ff;',
        '}',
        '',
        '.n-a7Kd93Bx2Qmz {',
        '  padding-top: 30px;',
        '}',
      ].join('\n'),
    );
  });
});
