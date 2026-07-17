import { describe, expect, it } from 'vitest';

import {
  EMPTY_DECLARATION,
  declarationEntries,
  declarationProperties,
  declarationsEqual,
  getDeclaration,
  isEmptyDeclaration,
  mergeDeclarations,
  setDeclaration,
  unsetDeclaration,
} from '../declaration.ts';
import { px } from '../values.ts';

describe('isEmptyDeclaration', () => {
  it('recognises empty and non-empty', () => {
    expect(isEmptyDeclaration(EMPTY_DECLARATION)).toBe(true);
    expect(isEmptyDeclaration({})).toBe(true);
    expect(isEmptyDeclaration({ paddingTop: px(1) })).toBe(false);
  });

  it('ignores inherited prototype properties', () => {
    expect(isEmptyDeclaration(Object.create({ paddingTop: px(1) }) as never)).toBe(true);
  });
});

describe('set / get / unset', () => {
  it('sets and reads', () => {
    const declaration = setDeclaration(EMPTY_DECLARATION, 'paddingTop', px(4));
    expect(getDeclaration(declaration, 'paddingTop')).toEqual(px(4));
  });

  it('does not mutate the input', () => {
    const before = setDeclaration(EMPTY_DECLARATION, 'paddingTop', px(4));
    const after = setDeclaration(before, 'marginTop', px(8));
    expect(getDeclaration(before, 'marginTop')).toBeUndefined();
    expect(before).not.toBe(after);
  });

  it('overwrites', () => {
    let declaration = setDeclaration(EMPTY_DECLARATION, 'paddingTop', px(4));
    declaration = setDeclaration(declaration, 'paddingTop', px(8));
    expect(getDeclaration(declaration, 'paddingTop')).toEqual(px(8));
  });

  /**
   * A key present with value `undefined` survives a spread and would shadow an
   * inherited value during a merge — reading as "explicitly set to nothing"
   * rather than "not set here". That is the difference between a Mobile override
   * clearing a Desktop value and correctly inheriting it.
   */
  it('unset DELETES the key rather than setting it undefined', () => {
    let declaration = setDeclaration(EMPTY_DECLARATION, 'paddingTop', px(4));
    declaration = unsetDeclaration(declaration, 'paddingTop');

    expect(Object.hasOwn(declaration, 'paddingTop')).toBe(false);
    expect(isEmptyDeclaration(declaration)).toBe(true);
  });

  it('an unset key cannot shadow a base value through a merge', () => {
    const base = setDeclaration(EMPTY_DECLARATION, 'paddingTop', px(40));
    const override = unsetDeclaration(
      setDeclaration(EMPTY_DECLARATION, 'paddingTop', px(10)),
      'paddingTop',
    );

    expect(getDeclaration(mergeDeclarations(base, override), 'paddingTop')).toEqual(px(40));
  });

  it('unset is a no-op for an absent key', () => {
    const declaration = setDeclaration(EMPTY_DECLARATION, 'paddingTop', px(4));
    expect(unsetDeclaration(declaration, 'marginTop')).toBe(declaration);
  });
});

describe('mergeDeclarations', () => {
  it('override wins per property', () => {
    expect(mergeDeclarations({ paddingTop: px(1) }, { paddingTop: px(2) }).paddingTop).toEqual(
      px(2),
    );
  });

  it('unions distinct properties', () => {
    expect(mergeDeclarations({ paddingTop: px(1) }, { marginTop: px(2) })).toEqual({
      paddingTop: px(1),
      marginTop: px(2),
    });
  });

  it('mutates neither input', () => {
    const a = { paddingTop: px(1) };
    const b = { marginTop: px(2) };
    mergeDeclarations(a, b);
    expect(a).toEqual({ paddingTop: px(1) });
    expect(b).toEqual({ marginTop: px(2) });
  });

  it('is associative, which is what makes the cascade a simple fold', () => {
    const a = { paddingTop: px(1) };
    const b = { paddingTop: px(2), marginTop: px(5) };
    const c = { paddingTop: px(3) };
    expect(mergeDeclarations(mergeDeclarations(a, b), c)).toEqual(
      mergeDeclarations(a, mergeDeclarations(b, c)),
    );
  });
});

/**
 * `Object.entries` widens keys to `string`, which would quietly re-open the
 * `Record<string, any>` hole this model exists to close. Declarations also arrive
 * from JSON, and JSON is untrusted.
 */
describe('declarationEntries', () => {
  it('returns typed pairs', () => {
    expect(declarationEntries({ paddingTop: px(4) })).toEqual([['paddingTop', px(4)]]);
  });

  it('drops keys that are not real style properties', () => {
    const corrupted = { paddingTop: px(4), notAProperty: px(9), 'font-size': px(2) } as never;
    expect(declarationProperties(corrupted)).toEqual(['paddingTop']);
  });

  it('drops explicit undefined values', () => {
    expect(declarationEntries({ paddingTop: undefined } as never)).toEqual([]);
  });

  it('is empty for an empty declaration', () => {
    expect(declarationEntries(EMPTY_DECLARATION)).toEqual([]);
  });
});

describe('declarationsEqual', () => {
  it('compares by property presence and value identity', () => {
    const value = px(4);
    expect(declarationsEqual({ paddingTop: value }, { paddingTop: value })).toBe(true);
    expect(declarationsEqual({ paddingTop: px(4) }, { paddingTop: px(8) })).toBe(false);
    expect(declarationsEqual({ paddingTop: px(4) }, {})).toBe(false);
    expect(declarationsEqual({ paddingTop: px(4) }, { marginTop: px(4) })).toBe(false);
  });

  it('is order-independent', () => {
    const a = { paddingTop: px(1), marginTop: px(2) };
    const b = { marginTop: px(2), paddingTop: px(1) };
    // Same value objects, different insertion order.
    expect(declarationsEqual({ ...a }, { ...b })).toBe(false); // distinct px() instances
    expect(declarationsEqual(a, { marginTop: a.marginTop, paddingTop: a.paddingTop })).toBe(true);
  });

  /**
   * Reference-based by design. Values are immutable and rebuilt by the
   * constructors on every edit, so an unchanged value is the same reference —
   * making "did anything change?" O(properties) instead of a deep walk through
   * nested shadows and gradient stops on every keystroke.
   */
  it('treats structurally equal but distinct value objects as different', () => {
    expect(declarationsEqual({ paddingTop: px(4) }, { paddingTop: px(4) })).toBe(false);
  });
});
