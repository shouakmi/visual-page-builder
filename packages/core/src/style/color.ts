import { formatNumber } from './units.ts';

/**
 * A colour, in the space the user authored it in.
 *
 * WHY PRESERVE THE SPACE instead of normalising everything to RGB on the way in:
 * a user who types `hsl(210, 90%, 50%)` and adjusts lightness expects to still be
 * editing HSL next time they open the panel. Round-tripping through RGB destroys
 * hue on greys (saturation 0 loses hue entirely) and makes the slider jump. The
 * importer has the same obligation in reverse — it must give back what the source
 * stylesheet said.
 *
 * `alpha` is REQUIRED and always in [0,1], never optional. An optional alpha
 * forces every consumer to write `c.alpha ?? 1`, and the one place that forgets
 * renders a transparent element in production.
 */
export type Color =
  | { readonly space: 'hex'; readonly hex: string; readonly alpha: number }
  | {
      readonly space: 'rgb';
      readonly r: number;
      readonly g: number;
      readonly b: number;
      readonly alpha: number;
    }
  | {
      readonly space: 'hsl';
      readonly h: number;
      readonly s: number;
      readonly l: number;
      readonly alpha: number;
    };

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

const clampChannel = (value: number): number => Math.round(clamp(value, 0, 255));
const clampAlpha = (value: number): number => clamp(value, 0, 1);

export function rgb(r: number, g: number, b: number, alpha = 1): Color {
  return {
    space: 'rgb',
    r: clampChannel(r),
    g: clampChannel(g),
    b: clampChannel(b),
    alpha: clampAlpha(alpha),
  };
}

export function hsl(h: number, s: number, l: number, alpha = 1): Color {
  return {
    space: 'hsl',
    // Hue is circular: 370deg and -350deg are both 10deg. Normalise rather than
    // clamp, or a hue slider dragged past 360 sticks instead of wrapping.
    h: ((h % 360) + 360) % 360,
    s: clamp(s, 0, 100),
    l: clamp(l, 0, 100),
    alpha: clampAlpha(alpha),
  };
}

/** Throws on malformed input; use `parseColor` for untrusted strings. */
export function hex(value: string, alpha = 1): Color {
  const normalised = normaliseHex(value);
  if (!normalised) throw new Error(`Invalid hex colour: ${JSON.stringify(value)}`);
  return { space: 'hex', hex: normalised.hex, alpha: clampAlpha(alpha * normalised.alpha) };
}

export const TRANSPARENT: Color = { space: 'rgb', r: 0, g: 0, b: 0, alpha: 0 };

/**
 * Accepts `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. Returns the 6-digit form plus
 * any alpha carried by the 4/8-digit variants, so alpha lives in exactly one
 * place on the resulting Color.
 */
function normaliseHex(value: string): { hex: string; alpha: number } | null {
  const raw = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(raw)) return null;

  const expand = (s: string) =>
    s
      .split('')
      .map((c) => c + c)
      .join('');

  switch (raw.length) {
    case 3:
      return { hex: `#${expand(raw).toLowerCase()}`, alpha: 1 };
    case 4:
      return {
        hex: `#${expand(raw.slice(0, 3)).toLowerCase()}`,
        alpha: Number.parseInt(expand(raw.slice(3)), 16) / 255,
      };
    case 6:
      return { hex: `#${raw.toLowerCase()}`, alpha: 1 };
    case 8:
      return {
        hex: `#${raw.slice(0, 6).toLowerCase()}`,
        alpha: Number.parseInt(raw.slice(6), 16) / 255,
      };
    default:
      return null;
  }
}

/**
 * Parse a CSS colour string.
 *
 * Supports hex, `rgb()`/`rgba()`, `hsl()`/`hsla()` in both legacy comma syntax
 * and modern space syntax, plus the `transparent` keyword.
 *
 * Returns `null` — never a guess — for anything else, including named colours
 * like `rebeccapurple`. Callers (notably the Phase G importer) must fall back to
 * a `raw` value on null. A partial named-colour table would be worse than none:
 * it would silently mis-render the names it forgot, and a wrong colour is harder
 * to notice than an unparsed one. Phase G adds the complete CSS named-colour
 * table as a unit-tested data module.
 */
export function parseColor(input: string): Color | null {
  const value = input.trim().toLowerCase();
  if (value === 'transparent') return TRANSPARENT;

  if (value.startsWith('#')) {
    const normalised = normaliseHex(value);
    return normalised ? { space: 'hex', hex: normalised.hex, alpha: normalised.alpha } : null;
  }

  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(value);
  if (!fn) return null;

  const name = fn[1];
  const body = fn[2];
  if (!name || body === undefined) return null;

  // Accept `1, 2, 3` and `1 2 3 / 0.5` alike.
  const parts = body
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;

  const num = (token: string | undefined, percentBasis: number | null): number | null => {
    if (token === undefined) return null;
    const isPercent = token.endsWith('%');
    const parsed = Number.parseFloat(isPercent ? token.slice(0, -1) : token);
    if (!Number.isFinite(parsed)) return null;
    if (isPercent && percentBasis !== null) return (parsed / 100) * percentBasis;
    return parsed;
  };

  const alphaToken = parts[3];
  const alpha = alphaToken === undefined ? 1 : (num(alphaToken, 1) ?? 1);

  if (name.startsWith('rgb')) {
    const r = num(parts[0], 255);
    const g = num(parts[1], 255);
    const b = num(parts[2], 255);
    if (r === null || g === null || b === null) return null;
    return rgb(r, g, b, alpha);
  }

  const h = num(parts[0], null);
  const s = num(parts[1], null);
  const l = num(parts[2], null);
  if (h === null || s === null || l === null) return null;
  return hsl(h, s, l, alpha);
}

/** Convert any colour to RGB. Needed by pickers, contrast checks, and export. */
export function toRgb(color: Color): Rgb {
  switch (color.space) {
    case 'rgb':
      return { r: color.r, g: color.g, b: color.b, alpha: color.alpha };

    case 'hex': {
      const value = color.hex.slice(1);
      return {
        r: Number.parseInt(value.slice(0, 2), 16),
        g: Number.parseInt(value.slice(2, 4), 16),
        b: Number.parseInt(value.slice(4, 6), 16),
        alpha: color.alpha,
      };
    }

    case 'hsl': {
      const h = color.h / 360;
      const s = color.s / 100;
      const l = color.l / 100;

      if (s === 0) {
        const grey = Math.round(l * 255);
        return { r: grey, g: grey, b: grey, alpha: color.alpha };
      }

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;

      const channel = (t: number): number => {
        let temp = t;
        if (temp < 0) temp += 1;
        if (temp > 1) temp -= 1;
        if (temp < 1 / 6) return p + (q - p) * 6 * temp;
        if (temp < 1 / 2) return q;
        if (temp < 2 / 3) return p + (q - p) * (2 / 3 - temp) * 6;
        return p;
      };

      return {
        r: Math.round(channel(h + 1 / 3) * 255),
        g: Math.round(channel(h) * 255),
        b: Math.round(channel(h - 1 / 3) * 255),
        alpha: color.alpha,
      };
    }
  }
}

/**
 * Serialise to CSS.
 *
 * Emits LEGACY comma syntax (`rgba(0, 0, 0, 0.5)`) rather than modern space
 * syntax (`rgb(0 0 0 / 50%)`). This output is not for our editor — it is shipped
 * to the user's customers, on hardware we do not choose. Legacy syntax is
 * universally supported and costs a handful of bytes. There is no upside to
 * being fashionable in someone else's production stylesheet.
 */
export function formatColor(color: Color): string {
  const n = formatNumber;

  switch (color.space) {
    case 'hex': {
      // A hex literal cannot carry alpha in a way older browsers accept, so fall
      // back to rgba() rather than emitting #rrggbbaa.
      if (color.alpha >= 1) return color.hex;
      const { r, g, b } = toRgb(color);
      return `rgba(${n(r)}, ${n(g)}, ${n(b)}, ${n(color.alpha)})`;
    }

    case 'rgb':
      return color.alpha >= 1
        ? `rgb(${n(color.r)}, ${n(color.g)}, ${n(color.b)})`
        : `rgba(${n(color.r)}, ${n(color.g)}, ${n(color.b)}, ${n(color.alpha)})`;

    case 'hsl':
      return color.alpha >= 1
        ? `hsl(${n(color.h)}, ${n(color.s)}%, ${n(color.l)}%)`
        : `hsla(${n(color.h)}, ${n(color.s)}%, ${n(color.l)}%, ${n(color.alpha)})`;
  }
}

/** Structural equality, space-sensitive. `#fff` and `rgb(255,255,255)` differ. */
export function colorsEqual(a: Color, b: Color): boolean {
  if (a.space !== b.space || a.alpha !== b.alpha) return false;
  if (a.space === 'hex' && b.space === 'hex') return a.hex === b.hex;
  if (a.space === 'rgb' && b.space === 'rgb') return a.r === b.r && a.g === b.g && a.b === b.b;
  if (a.space === 'hsl' && b.space === 'hsl') return a.h === b.h && a.s === b.s && a.l === b.l;
  return false;
}
