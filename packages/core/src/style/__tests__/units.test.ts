import { describe, expect, it } from 'vitest';

import { formatNumber, isAngleUnit, isLengthUnit, isTimeUnit } from '../units.ts';

describe('unit guards', () => {
  it('accept their own vocabulary', () => {
    expect(isLengthUnit('px')).toBe(true);
    expect(isLengthUnit('fr')).toBe(true);
    expect(isAngleUnit('deg')).toBe(true);
    expect(isTimeUnit('ms')).toBe(true);
  });

  /**
   * The reason these are three types and not one `Unit` union: a single union
   * would make `length(45, 'deg')` typecheck, and it would fail only in a
   * browser, silently, as a dropped declaration.
   */
  it('reject units from a different dimension', () => {
    expect(isLengthUnit('deg')).toBe(false);
    expect(isLengthUnit('ms')).toBe(false);
    expect(isAngleUnit('px')).toBe(false);
    expect(isTimeUnit('deg')).toBe(false);
  });

  it('reject junk', () => {
    for (const value of ['', 'PX', 'pixels', 42, null, undefined, {}]) {
      expect(isLengthUnit(value)).toBe(false);
    }
  });
});

describe('formatNumber', () => {
  it('prints plain integers and decimals', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(12)).toBe('12');
    expect(formatNumber(1.5)).toBe('1.5');
    expect(formatNumber(-8)).toBe('-8');
  });

  it('strips float arithmetic noise', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(1.005 * 100)).toBe('100.5');
  });

  it('rounds to 4dp, beyond sub-pixel precision', () => {
    expect(formatNumber(1 / 3)).toBe('0.3333');
    expect(formatNumber(2 / 3)).toBe('0.6667');
  });

  it('normalises negative zero', () => {
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(-0.00001)).toBe('0');
  });

  /**
   * The bug this test exists for: `toFixed` and `toString` both switch to
   * exponent notation at 1e21, and CSS has no exponent syntax. A declaration
   * containing `1e+21` is not clamped by the browser — it is DISCARDED, with no
   * error. `formatNumber(1e21)` used to return "1.0000000000000001e+21".
   */
  it('never emits exponent notation, at any magnitude', () => {
    for (const value of [1e20, 1e21, 1e22, 1e300, Number.MAX_VALUE, -1e21, -1e300]) {
      const out = formatNumber(value);
      expect(out, `formatNumber(${value}) = ${out}`).not.toContain('e');
      expect(out, `formatNumber(${value}) = ${out}`).not.toContain('E');
      expect(out).toMatch(/^-?[0-9]+(\.[0-9]+)?$/);
    }
  });

  it('never emits exponent notation for tiny magnitudes', () => {
    for (const value of [1e-7, 1e-21, Number.MIN_VALUE, -1e-21]) {
      expect(formatNumber(value)).toBe('0');
    }
  });

  it('clamps rather than overflowing into an unprintable number', () => {
    expect(formatNumber(Number.MAX_VALUE)).toBe('100000000000000000000');
    expect(formatNumber(-Number.MAX_VALUE)).toBe('-100000000000000000000');
  });

  /**
   * NaN and Infinity have no CSS spelling. They arrive from a UI divide-by-zero
   * (an aspect-ratio control, a percentage of a zero-height parent) and must not
   * reach a stylesheet as `NaNpx`, which silently kills the declaration.
   */
  it('degrades non-finite input to zero', () => {
    expect(formatNumber(Number.NaN)).toBe('0');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('0');
    expect(formatNumber(Number.NEGATIVE_INFINITY)).toBe('0');
    expect(formatNumber(0 / 0)).toBe('0');
    expect(formatNumber(1 / 0)).toBe('0');
  });

  it('output always re-parses to a finite number', () => {
    for (const value of [
      0,
      -0,
      1e21,
      -1e21,
      1e-9,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1 / 3,
      12.5,
    ]) {
      expect(Number.isFinite(Number.parseFloat(formatNumber(value)))).toBe(true);
    }
  });
});
