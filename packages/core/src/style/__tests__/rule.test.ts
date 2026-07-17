import { describe, expect, it } from 'vitest';

import type { ClassName, NodeId } from '../../identity/ids.ts';
import { unsafeId } from '../../identity/ids.ts';
import {
  classScope,
  isValidClassName,
  nodeScope,
  parseScopeKey,
  scopeKey,
  scopesEqual,
} from '../rule.ts';

const C = (v: string) => unsafeId<ClassName>(v);
const N = (v: string) => unsafeId<NodeId>(v);

describe('scopeKey', () => {
  it('is stable', () => {
    expect(scopeKey(classScope(C('btn')))).toBe(scopeKey(classScope(C('btn'))));
  });

  /**
   * A class named `x` and a node with id `x` are different things. Keying both as
   * plain "x" would merge their rules and silently apply one element's local
   * overrides to every element carrying an unrelated class.
   */
  it('never collides a class with a node of the same name', () => {
    expect(scopeKey(classScope(C('x')))).not.toBe(scopeKey(nodeScope(N('x'))));
  });

  it('round-trips through parseScopeKey', () => {
    expect(parseScopeKey(scopeKey(classScope(C('btn'))))).toEqual(classScope(C('btn')));
    expect(parseScopeKey(scopeKey(nodeScope(N('abc'))))).toEqual(nodeScope(N('abc')));
  });

  /** Class names may contain `-`; the key must survive them. */
  it('round-trips a hyphenated class name', () => {
    expect(parseScopeKey(scopeKey(classScope(C('btn-primary-lg'))))).toEqual(
      classScope(C('btn-primary-lg')),
    );
  });
});

describe('parseScopeKey', () => {
  it('rejects malformed keys', () => {
    for (const key of ['', 'btn', 'class:', 'node:', 'other:x', ':x']) {
      expect(parseScopeKey(key), key).toBeNull();
    }
  });
});

describe('scopesEqual', () => {
  it('compares kind and identity', () => {
    expect(scopesEqual(classScope(C('a')), classScope(C('a')))).toBe(true);
    expect(scopesEqual(classScope(C('a')), classScope(C('b')))).toBe(false);
    expect(scopesEqual(nodeScope(N('a')), nodeScope(N('a')))).toBe(true);
    expect(scopesEqual(classScope(C('a')), nodeScope(N('a')))).toBe(false);
  });
});

/**
 * Class names are USER INPUT — typed into the panel, or read out of an imported
 * stylesheet. An unchecked name lands straight in a selector.
 */
describe('isValidClassName', () => {
  it('accepts ordinary names', () => {
    for (const name of ['btn', 'btn-primary', 'Btn_2', '_private', 'a', '-vendor']) {
      expect(isValidClassName(name), name).toBe(true);
    }
  });

  it('rejects names that would break out of a selector', () => {
    for (const name of [
      'btn { } body { display: none } .x',
      'btn}',
      'btn{',
      'btn</style><script>alert(1)</script>',
      'btn;',
      'btn.other',
      'btn:hover',
      'btn x',
      'btn#id',
      'btn[attr]',
      'btn>child',
    ]) {
      expect(isValidClassName(name), `${name} must be rejected`).toBe(false);
    }
  });

  it('rejects a leading digit, which is invalid in a CSS identifier', () => {
    expect(isValidClassName('2col')).toBe(false);
    expect(isValidClassName('-2col')).toBe(false);
  });

  /** `--` is reserved for custom properties. */
  it('rejects a custom-property-style name', () => {
    expect(isValidClassName('--brand')).toBe(false);
  });

  it('rejects the empty name', () => {
    expect(isValidClassName('')).toBe(false);
  });
});
