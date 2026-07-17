import { describe, expect, it } from 'vitest';

import {
  colorsEqual,
  formatColor,
  hex,
  hsl,
  parseColor,
  rgb,
  toRgb,
  TRANSPARENT,
} from '../color.ts';

describe('rgb', () => {
  it('clamps channels into range', () => {
    expect(rgb(300, -5, 128)).toMatchObject({ r: 255, g: 0, b: 128 });
  });

  it('clamps alpha into [0,1]', () => {
    expect(rgb(0, 0, 0, 5)).toMatchObject({ alpha: 1 });
    expect(rgb(0, 0, 0, -1)).toMatchObject({ alpha: 0 });
  });

  it('rounds fractional channels', () => {
    expect(rgb(1.6, 2.4, 3.5)).toMatchObject({ r: 2, g: 2, b: 4 });
  });

  it('defaults alpha to 1 so no consumer needs `?? 1`', () => {
    expect(rgb(0, 0, 0).alpha).toBe(1);
  });
});

describe('hsl', () => {
  it('wraps hue rather than clamping — a hue slider is circular', () => {
    expect(hsl(370, 50, 50)).toMatchObject({ h: 10 });
    expect(hsl(-10, 50, 50)).toMatchObject({ h: 350 });
    expect(hsl(720, 50, 50)).toMatchObject({ h: 0 });
  });

  it('clamps saturation and lightness, which are not circular', () => {
    expect(hsl(0, 150, -20)).toMatchObject({ s: 100, l: 0 });
  });
});

describe('hex', () => {
  it('expands shorthand', () => {
    expect(hex('#abc')).toMatchObject({ space: 'hex', hex: '#aabbcc' });
  });

  it('normalises case and accepts a missing #', () => {
    expect(hex('#AABBCC')).toMatchObject({ hex: '#aabbcc' });
    expect(hex('aabbcc')).toMatchObject({ hex: '#aabbcc' });
  });

  it('lifts 8-digit alpha out of the hex and onto the colour', () => {
    const c = hex('#ff000080');
    expect(c).toMatchObject({ hex: '#ff0000' });
    expect(c.alpha).toBeCloseTo(0.502, 2);
  });

  it('throws on malformed input', () => {
    expect(() => hex('#xyz')).toThrow(/Invalid hex/);
    expect(() => hex('#12345')).toThrow(/Invalid hex/);
  });
});

describe('parseColor', () => {
  it('parses every hex length', () => {
    expect(parseColor('#abc')).toMatchObject({ hex: '#aabbcc', alpha: 1 });
    expect(parseColor('#aabbcc')).toMatchObject({ hex: '#aabbcc', alpha: 1 });
    expect(parseColor('#aabbccff')).toMatchObject({ hex: '#aabbcc', alpha: 1 });
  });

  it('parses legacy comma syntax', () => {
    expect(parseColor('rgb(1, 2, 3)')).toMatchObject({ r: 1, g: 2, b: 3, alpha: 1 });
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toMatchObject({ r: 1, g: 2, b: 3, alpha: 0.5 });
  });

  it('parses modern space syntax with a slash alpha', () => {
    expect(parseColor('rgb(1 2 3 / 0.5)')).toMatchObject({ r: 1, g: 2, b: 3, alpha: 0.5 });
  });

  it('parses percentage rgb channels', () => {
    expect(parseColor('rgb(100%, 0%, 50%)')).toMatchObject({ r: 255, g: 0, b: 128 });
  });

  it('parses hsl and hsla', () => {
    expect(parseColor('hsl(210, 90%, 50%)')).toMatchObject({ space: 'hsl', h: 210, s: 90, l: 50 });
    expect(parseColor('hsla(210, 90%, 50%, 0.25)')).toMatchObject({ alpha: 0.25 });
  });

  it('parses the transparent keyword', () => {
    expect(parseColor('transparent')).toEqual(TRANSPARENT);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(parseColor('  RGB( 1 , 2 , 3 )  ')).toMatchObject({ r: 1, g: 2, b: 3 });
  });

  /**
   * Returning null — rather than guessing — is the contract. Phase G falls back
   * to a `raw` value on null, which round-trips faithfully. A partial named-colour
   * table would be worse than none: it would silently mis-render the names it
   * forgot, and a wrong colour is far harder to notice than an unparsed one.
   */
  it('returns null rather than guessing at anything it does not model', () => {
    for (const input of [
      'rebeccapurple',
      'red',
      'currentColor',
      'color(display-p3 1 0 0)',
      'lab(50% 40 59)',
      'not a colour',
      '',
      '#',
      'rgb(1, 2)',
      'rgb(1, 2, 3, 4, 5)',
      'rgb(a, b, c)',
    ]) {
      expect(parseColor(input), `${input} should be null`).toBeNull();
    }
  });

  it('preserves the authored space so the editor shows the user their own units', () => {
    expect(parseColor('hsl(210, 90%, 50%)')?.space).toBe('hsl');
    expect(parseColor('rgb(1,2,3)')?.space).toBe('rgb');
    expect(parseColor('#abc')?.space).toBe('hex');
  });
});

describe('toRgb', () => {
  it('converts hex', () => {
    expect(toRgb(hex('#ff8000'))).toMatchObject({ r: 255, g: 128, b: 0 });
  });

  it('converts hsl primaries', () => {
    expect(toRgb(hsl(0, 100, 50))).toMatchObject({ r: 255, g: 0, b: 0 });
    expect(toRgb(hsl(120, 100, 50))).toMatchObject({ r: 0, g: 255, b: 0 });
    expect(toRgb(hsl(240, 100, 50))).toMatchObject({ r: 0, g: 0, b: 255 });
  });

  it('handles the achromatic case without NaN', () => {
    expect(toRgb(hsl(0, 0, 50))).toMatchObject({ r: 128, g: 128, b: 128 });
    expect(toRgb(hsl(0, 0, 100))).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(toRgb(hsl(0, 0, 0))).toMatchObject({ r: 0, g: 0, b: 0 });
  });

  it('carries alpha through', () => {
    expect(toRgb(hsl(0, 100, 50, 0.3)).alpha).toBe(0.3);
  });

  it('round-trips rgb -> hsl-ish -> rgb within rounding tolerance', () => {
    const original = { r: 34, g: 139, b: 34 };
    const asHsl = parseColor('hsl(120, 61%, 34%)');
    expect(asHsl).not.toBeNull();
    const back = toRgb(asHsl!);
    expect(Math.abs(back.r - original.r)).toBeLessThanOrEqual(2);
    expect(Math.abs(back.g - original.g)).toBeLessThanOrEqual(2);
    expect(Math.abs(back.b - original.b)).toBeLessThanOrEqual(2);
  });
});

describe('formatColor', () => {
  it('emits bare hex when fully opaque', () => {
    expect(formatColor(hex('#aabbcc'))).toBe('#aabbcc');
  });

  it('degrades hex+alpha to rgba, which old browsers understand', () => {
    expect(formatColor(hex('#ff0000', 0.5))).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('emits legacy comma syntax for compatibility in exported CSS', () => {
    expect(formatColor(rgb(1, 2, 3))).toBe('rgb(1, 2, 3)');
    expect(formatColor(rgb(1, 2, 3, 0.5))).toBe('rgba(1, 2, 3, 0.5)');
    expect(formatColor(hsl(210, 90, 50))).toBe('hsl(210, 90%, 50%)');
    expect(formatColor(hsl(210, 90, 50, 0.5))).toBe('hsla(210, 90%, 50%, 0.5)');
  });

  it('emits transparent as rgba with zero alpha', () => {
    expect(formatColor(TRANSPARENT)).toBe('rgba(0, 0, 0, 0)');
  });

  it('never emits float noise', () => {
    expect(formatColor(rgb(0, 0, 0, 0.1 + 0.2))).toBe('rgba(0, 0, 0, 0.3)');
  });

  it('round-trips through parseColor', () => {
    for (const input of ['#aabbcc', 'rgb(1, 2, 3)', 'rgba(1, 2, 3, 0.5)', 'hsl(210, 90%, 50%)']) {
      const parsed = parseColor(input);
      expect(parsed).not.toBeNull();
      expect(formatColor(parsed!)).toBe(input);
    }
  });
});

describe('colorsEqual', () => {
  it('compares within a space', () => {
    expect(colorsEqual(rgb(1, 2, 3), rgb(1, 2, 3))).toBe(true);
    expect(colorsEqual(rgb(1, 2, 3), rgb(1, 2, 4))).toBe(false);
  });

  it('is alpha-sensitive', () => {
    expect(colorsEqual(rgb(1, 2, 3), rgb(1, 2, 3, 0.5))).toBe(false);
  });

  it('is space-sensitive: authored representation is part of the value', () => {
    expect(colorsEqual(hex('#ffffff'), rgb(255, 255, 255))).toBe(false);
  });
});
