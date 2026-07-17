/**
 * CSS unit vocabularies, split by dimension.
 *
 * Deliberately three separate types rather than one `Unit` union. A single union
 * would let `length(45, 'deg')` and `rotate(10, 'px')` typecheck — nonsense that
 * only fails once it reaches a browser, silently, as a dropped declaration.
 */

export const LENGTH_UNITS = [
  'px',
  '%',
  'em',
  'rem',
  'vw',
  'vh',
  'vmin',
  'vmax',
  'ch',
  'ex',
  'cm',
  'mm',
  'in',
  'pt',
  'pc',
  /** Grid track sizing. Only meaningful inside grid-template-*. */
  'fr',
] as const;

export type LengthUnit = (typeof LENGTH_UNITS)[number];

export const ANGLE_UNITS = ['deg', 'rad', 'grad', 'turn'] as const;
export type AngleUnit = (typeof ANGLE_UNITS)[number];

export const TIME_UNITS = ['ms', 's'] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];

export function isLengthUnit(value: unknown): value is LengthUnit {
  return typeof value === 'string' && (LENGTH_UNITS as readonly string[]).includes(value);
}

export function isAngleUnit(value: unknown): value is AngleUnit {
  return typeof value === 'string' && (ANGLE_UNITS as readonly string[]).includes(value);
}

export function isTimeUnit(value: unknown): value is TimeUnit {
  return typeof value === 'string' && (TIME_UNITS as readonly string[]).includes(value);
}

/**
 * Largest magnitude we will print.
 *
 * Both `Number.prototype.toString` and `toFixed` switch to exponent notation at
 * 1e21, and CSS has no exponent syntax — a declaration containing `1e+21`
 * is not "clamped" by the browser, it is DISCARDED, silently. Staying under the
 * threshold means the formatter can never produce a value that deletes its own
 * declaration.
 *
 * 1e20 is far beyond anything meaningful: the largest legal z-index is ~2.1e9,
 * and a length of 1e20px is roughly ten thousand light years.
 */
const MAX_MAGNITUDE = 1e20;

/**
 * Format a number for CSS output.
 *
 * Naive printing leaks artefacts into generated stylesheets, each of which is a
 * silently broken declaration in someone's production site:
 *
 *   `0.30000000000000004px`  float arithmetic
 *   `1e-7px` / `1e+21`       exponent notation, which CSS rejects outright
 *   `-0px`                   valid but noise
 *   `NaNpx` / `Infinitypx`   from a division the UI failed to guard
 *
 * Rounds to 4 decimal places — beyond sub-pixel precision for any real layout —
 * clamps to a printable magnitude, then strips trailing zeros.
 */
export function formatNumber(value: number): string {
  // NaN and ±Infinity have no CSS spelling. `0` is the only safe answer; the
  // alternative is a declaration the browser throws away without telling anyone.
  if (!Number.isFinite(value)) return '0';

  const clamped = Math.min(Math.max(value, -MAX_MAGNITUDE), MAX_MAGNITUDE);
  const rounded = Math.round(clamped * 10_000) / 10_000;

  // Catches both `0` and `-0`, and anything that rounded down to them.
  if (rounded === 0) return '0';

  // toFixed is exponent-free below 1e21, which the clamp above guarantees.
  // Strip the trailing zeros it always pads with (and the dot, if bare).
  const text = rounded.toFixed(4).replace(/\.?0+$/, '');
  return text === '' || text === '-' ? '0' : text;
}
