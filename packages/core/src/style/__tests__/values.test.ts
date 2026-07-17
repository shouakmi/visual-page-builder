import { describe, expect, it } from 'vitest';

import type { AssetId, TokenId } from '../../identity/ids.ts';
import { hex } from '../color.ts';
import {
  color,
  deg,
  isColor,
  isLength,
  isRaw,
  isToken,
  linearGradient,
  list,
  px,
  raw,
  referencedAssets,
  referencedTokens,
  shadow,
  stop,
  token,
  url,
} from '../values.ts';

const T = (v: string) => v as TokenId;
const A = (v: string) => v as AssetId;

describe('constructors', () => {
  it('build tagged values', () => {
    expect(px(4)).toEqual({ kind: 'length', value: 4, unit: 'px' });
    expect(deg(90)).toEqual({ kind: 'angle', value: 90, unit: 'deg' });
  });

  it('default a shadow to non-inset with no spread', () => {
    const s = shadow({ offsetX: px(0), offsetY: px(0), blur: px(0), color: color(hex('#000')) });
    expect(s.inset).toBe(false);
    expect(s.spread).toBeNull();
  });

  it('default a token to no fallback', () => {
    expect(token(T('a')).fallback).toBeNull();
  });

  it('default a url to no asset linkage', () => {
    expect(url('/a.png').assetId).toBeNull();
  });
});

describe('guards', () => {
  it('narrow by kind', () => {
    expect(isLength(px(1))).toBe(true);
    expect(isLength(deg(1))).toBe(false);
    expect(isColor(color(hex('#fff')))).toBe(true);
    expect(isToken(token(T('a')))).toBe(true);
    expect(isRaw(raw('x'))).toBe(true);
  });
});

/**
 * Answers "what breaks if I delete this token?" BEFORE the user deletes it.
 *
 * Tokens hide inside shadow colours and gradient stops, so a shallow scan would
 * report a token as unused and let the user delete a colour that half the site
 * depends on.
 */
describe('referencedTokens', () => {
  it('finds a direct reference', () => {
    expect([...referencedTokens(token(T('brand')))]).toEqual(['brand']);
  });

  it('finds a token hidden in a fallback', () => {
    expect([...referencedTokens(token(T('a'), token(T('b'))))].sort()).toEqual(['a', 'b']);
  });

  it('finds a token nested in a shadow colour', () => {
    const s = shadow({
      offsetX: px(0),
      offsetY: px(0),
      blur: px(0),
      color: token(T('shadowColor')),
    });
    expect([...referencedTokens(s)]).toEqual(['shadowColor']);
  });

  it('finds tokens nested in gradient stops', () => {
    const g = linearGradient(deg(0), [stop(token(T('from'))), stop(token(T('to')))]);
    expect([...referencedTokens(g)].sort()).toEqual(['from', 'to']);
  });

  it('finds tokens nested inside lists of shadows', () => {
    const a = shadow({ offsetX: px(0), offsetY: px(0), blur: px(0), color: token(T('t1')) });
    const b = shadow({ offsetX: px(0), offsetY: px(0), blur: px(0), color: token(T('t2')) });
    expect([...referencedTokens(list([a, b]))].sort()).toEqual(['t1', 't2']);
  });

  it('deduplicates', () => {
    const g = linearGradient(deg(0), [stop(token(T('x'))), stop(token(T('x')))]);
    expect([...referencedTokens(g)]).toEqual(['x']);
  });

  it('returns empty for token-free values', () => {
    expect([...referencedTokens(px(4))]).toEqual([]);
    expect([...referencedTokens(color(hex('#fff')))]).toEqual([]);
  });
});

/**
 * Drives "ship only what is referenced" in the exporter and safe-delete in the
 * asset manager.
 */
describe('referencedAssets', () => {
  it('finds a linked asset', () => {
    expect([...referencedAssets(url('/a.png', A('asset-1')))]).toEqual(['asset-1']);
  });

  it('ignores an unlinked url', () => {
    expect([...referencedAssets(url('https://cdn.example.com/a.png'))]).toEqual([]);
  });

  it('finds assets inside lists', () => {
    expect(
      [...referencedAssets(list([url('/a.png', A('a1')), url('/b.png', A('a2'))]))].sort(),
    ).toEqual(['a1', 'a2']);
  });

  it('finds an asset inside a token fallback', () => {
    expect([...referencedAssets(token(T('t'), url('/a.png', A('a1'))))]).toEqual(['a1']);
  });
});
