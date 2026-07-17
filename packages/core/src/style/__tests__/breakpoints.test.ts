import { describe, expect, it } from 'vitest';

import type { BreakpointId } from '../../identity/ids.ts';
import { unsafeId } from '../../identity/ids.ts';
import {
  BASE_BREAKPOINT_ID,
  MOBILE_BREAKPOINT_ID,
  TABLET_BREAKPOINT_ID,
  baseBreakpoint,
  cascadeChain,
  createBreakpointSet,
  cssOrder,
  defaultBreakpoints,
  getBreakpoint,
  mediaQuery,
  validateBreakpointSet,
  type Breakpoint,
} from '../breakpoints.ts';

const B = (v: string) => unsafeId<BreakpointId>(v);

describe('defaultBreakpoints', () => {
  it('is valid', () => {
    expect(validateBreakpointSet(defaultBreakpoints().breakpoints)).toEqual([]);
  });

  it('is desktop-first: base carries no media query', () => {
    const base = baseBreakpoint(defaultBreakpoints());
    expect(base.id).toBe(BASE_BREAKPOINT_ID);
    expect(base.media).toBeNull();
    expect(base.label).toBe('Desktop');
  });

  it('narrows via max-width down the ladder', () => {
    const set = defaultBreakpoints();
    expect(getBreakpoint(set, TABLET_BREAKPOINT_ID)?.media).toEqual({
      minWidth: null,
      maxWidth: 991,
    });
    expect(getBreakpoint(set, MOBILE_BREAKPOINT_ID)?.media).toEqual({
      minWidth: null,
      maxWidth: 479,
    });
  });

  it('uses stable ids, because they are persisted in every rule', () => {
    // Regenerating these per project would make a rule authored in one project
    // meaningless in another, breaking copy/paste and shared components.
    expect(defaultBreakpoints().breakpoints.map((b) => b.id)).toEqual([
      'base',
      'tablet',
      'mobile-landscape',
      'mobile',
    ]);
  });
});

/**
 * THE BUG THIS MODULE EXISTS TO KILL.
 *
 * The prototype resolved `props.styles?.[breakpoint]` — the exact breakpoint and
 * nothing else. Set padding on Desktop, switch to Mobile, padding gone. Every
 * commercial builder inherits down the ladder; anything else means restyling the
 * whole site once per breakpoint.
 */
describe('cascadeChain', () => {
  const set = defaultBreakpoints();

  it('base resolves to itself alone', () => {
    expect(cascadeChain(set, BASE_BREAKPOINT_ID).map((b) => b.id)).toEqual(['base']);
  });

  it('tablet inherits from base', () => {
    expect(cascadeChain(set, TABLET_BREAKPOINT_ID).map((b) => b.id)).toEqual(['base', 'tablet']);
  });

  it('mobile inherits the whole ladder, base first', () => {
    expect(cascadeChain(set, MOBILE_BREAKPOINT_ID).map((b) => b.id)).toEqual([
      'base',
      'tablet',
      'mobile-landscape',
      'mobile',
    ]);
  });

  it('is ordered weakest-first, so a naive merge gives the right answer', () => {
    const chain = cascadeChain(set, MOBILE_BREAKPOINT_ID);
    expect(chain[0]?.id).toBe(BASE_BREAKPOINT_ID);
    expect(chain.at(-1)?.id).toBe(MOBILE_BREAKPOINT_ID);
  });

  /**
   * Deleting a custom breakpoint must not crash the editor for every rule that
   * referenced it. Rules go inert and are reported by `orphanedRules` instead.
   */
  it('degrades rather than throwing for an unknown breakpoint', () => {
    expect(() => cascadeChain(set, B('deleted'))).not.toThrow();
    expect(cascadeChain(set, B('deleted'))).toEqual([]);
  });

  it('throws on a cycle rather than hanging', () => {
    // Constructed directly: createBreakpointSet would reject this.
    const cyclic = {
      breakpoints: [
        { id: B('a'), label: 'A', media: { minWidth: null, maxWidth: 100 }, inheritsFrom: B('b') },
        { id: B('b'), label: 'B', media: { minWidth: null, maxWidth: 200 }, inheritsFrom: B('a') },
      ] satisfies Breakpoint[],
    };
    expect(() => cascadeChain(cyclic, B('a'))).toThrow(/cycle/i);
  });
});

describe('cssOrder', () => {
  it('emits parents before children', () => {
    expect(cssOrder(defaultBreakpoints()).map((b) => b.id)).toEqual([
      'base',
      'tablet',
      'mobile-landscape',
      'mobile',
    ]);
  });

  /**
   * Media queries add no specificity, so which breakpoint wins is decided purely
   * by source order. Emission order MUST be a linear extension of the same
   * inheritance edges the resolver walks, or the browser and the editor will
   * disagree — the WYSIWYG invariant, in one assertion.
   */
  it('is a linear extension of the inheritance graph', () => {
    const set = defaultBreakpoints();
    const order = cssOrder(set).map((b) => b.id);
    for (const bp of set.breakpoints) {
      if (bp.inheritsFrom === null) continue;
      expect(order.indexOf(bp.inheritsFrom)).toBeLessThan(order.indexOf(bp.id));
    }
  });

  it('handles a branching tree, not just a ladder', () => {
    const set = createBreakpointSet([
      { id: B('base'), label: 'Base', media: null, inheritsFrom: null },
      {
        id: B('wide'),
        label: 'Wide',
        media: { minWidth: 1440, maxWidth: null },
        inheritsFrom: B('base'),
      },
      {
        id: B('tab'),
        label: 'Tablet',
        media: { minWidth: null, maxWidth: 991 },
        inheritsFrom: B('base'),
      },
      {
        id: B('mob'),
        label: 'Mobile',
        media: { minWidth: null, maxWidth: 479 },
        inheritsFrom: B('tab'),
      },
    ]);
    const order = cssOrder(set).map((b) => b.id);
    expect(order[0]).toBe('base');
    expect(order.indexOf(B('tab'))).toBeLessThan(order.indexOf(B('mob')));
    expect(order).toHaveLength(4);
  });

  it('inherits down a min-width branch too — "wider" need not mean "parent"', () => {
    const set = createBreakpointSet([
      { id: B('base'), label: 'Base', media: null, inheritsFrom: null },
      {
        id: B('wide'),
        label: 'Wide',
        media: { minWidth: 1440, maxWidth: null },
        inheritsFrom: B('base'),
      },
    ]);
    expect(cascadeChain(set, B('wide')).map((b) => b.id)).toEqual(['base', 'wide']);
  });
});

describe('mediaQuery', () => {
  const set = defaultBreakpoints();

  it('returns null for base, which needs no wrapper', () => {
    expect(mediaQuery(baseBreakpoint(set))).toBeNull();
  });

  it('emits max-width', () => {
    expect(mediaQuery(getBreakpoint(set, TABLET_BREAKPOINT_ID)!)).toBe('@media (max-width: 991px)');
  });

  it('emits min-width', () => {
    expect(
      mediaQuery({
        id: B('w'),
        label: 'W',
        media: { minWidth: 1440, maxWidth: null },
        inheritsFrom: B('base'),
      }),
    ).toBe('@media (min-width: 1440px)');
  });

  it('ands both bounds', () => {
    expect(
      mediaQuery({
        id: B('r'),
        label: 'R',
        media: { minWidth: 768, maxWidth: 991 },
        inheritsFrom: B('base'),
      }),
    ).toBe('@media (min-width: 768px) and (max-width: 991px)');
  });
});

describe('validateBreakpointSet', () => {
  const base: Breakpoint = { id: B('base'), label: 'Base', media: null, inheritsFrom: null };

  it('requires a base', () => {
    const errors = validateBreakpointSet([
      {
        id: B('a'),
        label: 'A',
        media: { minWidth: null, maxWidth: 100 },
        inheritsFrom: B('missing'),
      },
    ]);
    expect(errors.join(' ')).toMatch(/no base breakpoint/i);
  });

  it('rejects two bases', () => {
    expect(
      validateBreakpointSet([
        base,
        { id: B('b2'), label: 'B2', media: null, inheritsFrom: null },
      ]).join(' '),
    ).toMatch(/multiple base/i);
  });

  it('rejects duplicate ids', () => {
    expect(validateBreakpointSet([base, base]).join(' ')).toMatch(/duplicate/i);
  });

  it('rejects an unknown parent', () => {
    expect(
      validateBreakpointSet([
        base,
        {
          id: B('a'),
          label: 'A',
          media: { minWidth: null, maxWidth: 10 },
          inheritsFrom: B('ghost'),
        },
      ]).join(' '),
    ).toMatch(/unknown/i);
  });

  /** A non-base with no media matches everywhere: a second base in disguise. */
  it('rejects a non-base without a media condition', () => {
    expect(
      validateBreakpointSet([
        base,
        { id: B('a'), label: 'A', media: null, inheritsFrom: B('base') },
      ]).join(' '),
    ).toMatch(/must have a media condition/i);
  });

  it('rejects a base that carries a media condition', () => {
    expect(
      validateBreakpointSet([
        { id: B('base'), label: 'B', media: { minWidth: null, maxWidth: 100 }, inheritsFrom: null },
      ]).join(' '),
    ).toMatch(/must not have a media condition/i);
  });

  it('rejects inverted bounds', () => {
    expect(
      validateBreakpointSet([
        base,
        {
          id: B('a'),
          label: 'A',
          media: { minWidth: 900, maxWidth: 100 },
          inheritsFrom: B('base'),
        },
      ]).join(' '),
    ).toMatch(/minWidth greater than maxWidth/i);
  });

  it('rejects an empty media condition', () => {
    expect(
      validateBreakpointSet([
        base,
        {
          id: B('a'),
          label: 'A',
          media: { minWidth: null, maxWidth: null },
          inheritsFrom: B('base'),
        },
      ]).join(' '),
    ).toMatch(/empty media condition/i);
  });

  it('rejects an empty label', () => {
    expect(
      validateBreakpointSet([
        base,
        {
          id: B('a'),
          label: '  ',
          media: { minWidth: null, maxWidth: 10 },
          inheritsFrom: B('base'),
        },
      ]).join(' '),
    ).toMatch(/empty label/i);
  });

  /** Custom breakpoints are user-editable; someone will point two at each other. */
  it('detects a cycle without hanging', () => {
    expect(
      validateBreakpointSet([
        base,
        { id: B('a'), label: 'A', media: { minWidth: null, maxWidth: 10 }, inheritsFrom: B('b') },
        { id: B('b'), label: 'B', media: { minWidth: null, maxWidth: 20 }, inheritsFrom: B('a') },
      ]).join(' '),
    ).toMatch(/cycle/i);
  });

  it('reports every problem at once, not just the first', () => {
    const errors = validateBreakpointSet([
      { id: B('x'), label: '', media: null, inheritsFrom: B('ghost') },
    ]);
    expect(errors.length).toBeGreaterThan(1);
  });

  it('accepts a valid custom set', () => {
    expect(
      validateBreakpointSet([
        base,
        {
          id: B('a'),
          label: 'A',
          media: { minWidth: null, maxWidth: 700 },
          inheritsFrom: B('base'),
        },
      ]),
    ).toEqual([]);
  });
});

describe('createBreakpointSet', () => {
  it('throws with every problem listed', () => {
    expect(() => createBreakpointSet([])).toThrow(/at least a base/i);
  });

  it('returns the set when valid', () => {
    expect(createBreakpointSet(defaultBreakpoints().breakpoints).breakpoints).toHaveLength(4);
  });
});
