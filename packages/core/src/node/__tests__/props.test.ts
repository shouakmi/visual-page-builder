import { describe, expect, it } from 'vitest';

import type { AssetId } from '../../identity/ids.ts';
import { unsafeId } from '../../identity/ids.ts';
import type { PropDefinition } from '../props.ts';
import {
  EMPTY_PROPS,
  acceptsPropValue,
  getProp,
  propAsset,
  propBoolean,
  propNumber,
  propString,
  propToString,
  propUrl,
  propsEqual,
  referencedAssets,
  setProp,
  unsetProp,
} from '../props.ts';

const asset = (v: string) => unsafeId<AssetId>(v);
const def = (
  type: PropDefinition['type'],
  options?: PropDefinition['options'],
): PropDefinition => ({
  name: 'p',
  label: 'P',
  type,
  ...(options ? { options } : {}),
});

describe('constructors', () => {
  it('tag every value with its kind', () => {
    expect(propString('x')).toEqual({ kind: 'string', value: 'x' });
    expect(propNumber(3)).toEqual({ kind: 'number', value: 3 });
    expect(propBoolean(true)).toEqual({ kind: 'boolean', value: true });
    expect(propAsset(asset('a1'))).toEqual({ kind: 'asset', id: 'a1' });
    expect(propUrl('/about')).toEqual({ kind: 'url', href: '/about' });
  });
});

describe('acceptsPropValue', () => {
  it('matches string types', () => {
    expect(acceptsPropValue(def('string'), propString('x'))).toBe(true);
    expect(acceptsPropValue(def('multiline'), propString('x'))).toBe(true);
    expect(acceptsPropValue(def('string'), propNumber(1))).toBe(false);
  });

  it('matches scalar types', () => {
    expect(acceptsPropValue(def('number'), propNumber(1))).toBe(true);
    expect(acceptsPropValue(def('boolean'), propBoolean(false))).toBe(true);
    expect(acceptsPropValue(def('number'), propString('1'))).toBe(false);
  });

  /** A url is not a string: the exporter resolves one against the site root. */
  it('keeps url and asset distinct from string', () => {
    expect(acceptsPropValue(def('url'), propUrl('/x'))).toBe(true);
    expect(acceptsPropValue(def('url'), propString('/x'))).toBe(false);
    expect(acceptsPropValue(def('asset'), propAsset(asset('a1')))).toBe(true);
    expect(acceptsPropValue(def('asset'), propString('a1'))).toBe(false);
  });

  it('requires a select value to be one of its options', () => {
    const select = def('select', [{ value: 'sm', label: 'Small' }]);

    expect(acceptsPropValue(select, propString('sm'))).toBe(true);
    expect(acceptsPropValue(select, propString('xl'))).toBe(false);
  });

  it('rejects any select value when options are missing', () => {
    expect(acceptsPropValue(def('select'), propString('sm'))).toBe(false);
  });
});

describe('reading and writing', () => {
  it('sets without mutating', () => {
    const next = setProp(EMPTY_PROPS, 'alt', propString('Hero'));

    expect(getProp(next, 'alt')).toEqual(propString('Hero'));
    expect(EMPTY_PROPS).toEqual({});
  });

  it('overwrites', () => {
    const next = setProp(setProp(EMPTY_PROPS, 'alt', propString('a')), 'alt', propString('b'));
    expect(getProp(next, 'alt')).toEqual(propString('b'));
  });

  it('unsets', () => {
    const props = setProp(EMPTY_PROPS, 'alt', propString('a'));
    expect(getProp(unsetProp(props, 'alt'), 'alt')).toBeUndefined();
  });

  it('returns the same object when unsetting something absent', () => {
    const props = setProp(EMPTY_PROPS, 'alt', propString('a'));
    expect(unsetProp(props, 'nope')).toBe(props);
  });

  it('reads a missing prop as undefined', () => {
    expect(getProp(EMPTY_PROPS, 'nope')).toBeUndefined();
  });
});

describe('propToString', () => {
  it('flattens every kind for the renderer', () => {
    expect(propToString(propString('x'))).toBe('x');
    expect(propToString(propUrl('/about'))).toBe('/about');
    expect(propToString(propAsset(asset('a1')))).toBe('a1');
    expect(propToString(propNumber(3))).toBe('3');
    expect(propToString(propBoolean(true))).toBe('true');
    expect(propToString(undefined)).toBeUndefined();
  });
});

describe('referencedAssets', () => {
  /**
   * The entire argument for a structured PropValue. With `src` as a bare string
   * there is no way to answer "which nodes use this asset?", so deleting an asset
   * silently breaks pages and the exporter cannot rewrite paths.
   */
  it('finds asset props and ignores lookalike strings', () => {
    const props = {
      src: propAsset(asset('hero')),
      poster: propAsset(asset('poster')),
      alt: propString('hero'),
      href: propUrl('hero'),
    };

    expect(referencedAssets(props)).toEqual(['hero', 'poster']);
  });

  it('deduplicates', () => {
    const props = { a: propAsset(asset('x')), b: propAsset(asset('x')) };
    expect(referencedAssets(props)).toEqual(['x']);
  });

  it('is empty when nothing references an asset', () => {
    expect(referencedAssets({ alt: propString('x') })).toEqual([]);
  });
});

describe('propsEqual', () => {
  it('compares by value', () => {
    expect(propsEqual({ a: propString('x') }, { a: propString('x') })).toBe(true);
    expect(propsEqual({ a: propString('x') }, { a: propString('y') })).toBe(false);
  });

  it('compares assets and urls by their own field', () => {
    expect(propsEqual({ a: propAsset(asset('1')) }, { a: propAsset(asset('1')) })).toBe(true);
    expect(propsEqual({ a: propAsset(asset('1')) }, { a: propAsset(asset('2')) })).toBe(false);
    expect(propsEqual({ a: propUrl('/x') }, { a: propUrl('/x') })).toBe(true);
    expect(propsEqual({ a: propUrl('/x') }, { a: propUrl('/y') })).toBe(false);
  });

  it('distinguishes kinds that stringify the same', () => {
    expect(propsEqual({ a: propString('1') }, { a: propNumber(1) })).toBe(false);
  });

  it('compares key sets', () => {
    expect(propsEqual({ a: propString('x') }, { a: propString('x'), b: propString('y') })).toBe(
      false,
    );
    expect(propsEqual({ a: propString('x'), b: propString('y') }, { a: propString('x') })).toBe(
      false,
    );
  });

  it('treats two empty prop sets as equal', () => {
    expect(propsEqual(EMPTY_PROPS, {})).toBe(true);
  });
});
