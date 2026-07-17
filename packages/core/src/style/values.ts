import type { AssetId, TokenId } from '../identity/ids.ts';
import type { Color } from './color.ts';
import type { AngleUnit, LengthUnit, TimeUnit } from './units.ts';

/**
 * THE STYLE VALUE MODEL.
 *
 * This file is the reason Phase B exists.
 *
 * The prototype modelled a node's style as an opaque CSS *string*
 * (`"padding:40px;"`). A string cannot express a hover state, a transition, a
 * keyframe, a pseudo-element, a media query, or a design-token reference — which
 * is most of the specification. It also cannot be edited without parsing and
 * re-serialising on every keystroke, cannot be diffed meaningfully, cannot be
 * validated, and cannot tell you whether `40px` is a length or a typo.
 *
 * Here a value is a discriminated union. Every variant knows what it is, so:
 *
 *   - the style panel renders the right control (unit picker vs colour picker)
 *     by switching on `kind`, with the compiler checking exhaustiveness;
 *   - the serialiser emits correct CSS without regexes;
 *   - a design token is a first-class *reference*, so retheming updates every
 *     use rather than requiring find-and-replace over strings;
 *   - an image carries its `assetId`, so the exporter can rewrite `blob:` URLs
 *     to packaged paths — the fix for the prototype's dead-image-on-reload bug;
 *   - diffing compares structure, not text.
 *
 * DESIGN NOTE — every variant is `readonly`. Style values are treated as
 * immutable value objects: mutating one in place would silently change every
 * rule that shares the reference. Construct a new one instead; the factory
 * functions at the bottom make that cheap.
 */

export type StyleValueKind =
  | 'keyword'
  | 'length'
  | 'number'
  | 'color'
  | 'angle'
  | 'time'
  | 'string'
  | 'token'
  | 'url'
  | 'list'
  | 'shadow'
  | 'gradient'
  | 'transform'
  | 'raw';

/** `flex`, `auto`, `none`, `center` — an identifier from a fixed vocabulary. */
export interface KeywordValue {
  readonly kind: 'keyword';
  readonly value: string;
}

export interface LengthValue {
  readonly kind: 'length';
  readonly value: number;
  readonly unit: LengthUnit;
}

/** Unitless: `line-height: 1.5`, `z-index: 10`, `opacity: 0.5`, `flex-grow: 1`. */
export interface NumberValue {
  readonly kind: 'number';
  readonly value: number;
}

export interface ColorValue {
  readonly kind: 'color';
  readonly value: Color;
}

export interface AngleValue {
  readonly kind: 'angle';
  readonly value: number;
  readonly unit: AngleUnit;
}

export interface TimeValue {
  readonly kind: 'time';
  readonly value: number;
  readonly unit: TimeUnit;
}

/**
 * A quoted string: `content: "→"`, a font family with spaces.
 * Distinct from `keyword` because it MUST be quoted and escaped on output.
 */
export interface StringValue {
  readonly kind: 'string';
  readonly value: string;
}

/**
 * A reference to a design token — the spec's Design Tokens / Variables /
 * Global Colors / Global Typography, all of which are the same primitive.
 *
 * A reference, not a copy. Changing the token's value updates every rule that
 * points at it. Compiles to `var(--token-name, <fallback>)`; the fallback is
 * what renders if the token was deleted out from under the rule.
 */
export interface TokenValue {
  readonly kind: 'token';
  readonly token: TokenId;
  readonly fallback: StyleValue | null;
}

/**
 * `url(...)`.
 *
 * `assetId` is the whole point. The prototype stored `URL.createObjectURL()`
 * blob URLs directly in the project; those are invalidated on reload, so every
 * image in a reopened project was permanently broken, and every exported page
 * shipped dead `blob:` links. Carrying the asset identity means storage can
 * rehydrate a live URL on load and the exporter can rewrite to `assets/hero.webp`
 * on the way out. `src` is a cache of the currently-resolvable URL, never the
 * source of truth.
 */
export interface UrlValue {
  readonly kind: 'url';
  readonly src: string;
  readonly assetId: AssetId | null;
}

/** `font-family: a, b, c` (comma) or `margin: 0 auto` (space). */
export interface ListValue {
  readonly kind: 'list';
  readonly values: readonly StyleValue[];
  readonly separator: ', ' | ' ';
}

/**
 * One shadow. `box-shadow` and `text-shadow` take a comma `list` of these.
 *
 * `spread: null` and `inset: false` express a text-shadow, which supports
 * neither. Encoding the difference in the value (rather than in two near-identical
 * types) keeps the shadow editor a single component.
 */
export interface ShadowValue {
  readonly kind: 'shadow';
  readonly inset: boolean;
  readonly offsetX: LengthValue;
  readonly offsetY: LengthValue;
  readonly blur: LengthValue;
  readonly spread: LengthValue | null;
  readonly color: ColorValue | TokenValue;
}

export interface GradientStop {
  readonly color: ColorValue | TokenValue;
  /** `null` = let the browser distribute this stop evenly. */
  readonly position: LengthValue | null;
}

export type GradientValue =
  | {
      readonly kind: 'gradient';
      readonly type: 'linear';
      readonly angle: AngleValue;
      readonly repeating: boolean;
      readonly stops: readonly GradientStop[];
    }
  | {
      readonly kind: 'gradient';
      readonly type: 'radial';
      readonly shape: 'circle' | 'ellipse';
      readonly repeating: boolean;
      readonly stops: readonly GradientStop[];
    };

export type TransformFunction =
  | { readonly fn: 'translate'; readonly x: LengthValue; readonly y: LengthValue }
  | { readonly fn: 'translateX'; readonly value: LengthValue }
  | { readonly fn: 'translateY'; readonly value: LengthValue }
  | { readonly fn: 'translateZ'; readonly value: LengthValue }
  | { readonly fn: 'scale'; readonly x: number; readonly y: number }
  | { readonly fn: 'scaleX'; readonly value: number }
  | { readonly fn: 'scaleY'; readonly value: number }
  | { readonly fn: 'rotate'; readonly angle: AngleValue }
  | { readonly fn: 'rotateX'; readonly angle: AngleValue }
  | { readonly fn: 'rotateY'; readonly angle: AngleValue }
  | { readonly fn: 'rotateZ'; readonly angle: AngleValue }
  | { readonly fn: 'skew'; readonly x: AngleValue; readonly y: AngleValue }
  | { readonly fn: 'skewX'; readonly angle: AngleValue }
  | { readonly fn: 'skewY'; readonly angle: AngleValue }
  | { readonly fn: 'perspective'; readonly value: LengthValue };

/**
 * An ORDERED list of transform functions.
 *
 * Order is semantic, not cosmetic: `translate() rotate()` and `rotate()
 * translate()` place an element in different positions. Modelling transform as a
 * list rather than a string is what lets the Phase E rotate handle mutate only
 * the `rotate` entry while leaving a translate the user set earlier intact —
 * exactly what the prototype's full-string replacement destroyed.
 */
export interface TransformValue {
  readonly kind: 'transform';
  readonly functions: readonly TransformFunction[];
}

/**
 * Escape hatch: verbatim CSS text.
 *
 * Exists for ONE reason — import fidelity. The Phase G importer will meet real
 * stylesheets containing things this model does not represent (`clip-path`
 * polygons, vendor prefixes, `calc()` trees, `env()`). The alternative to `raw`
 * is silently dropping those declarations, which would make a round-trip lossy
 * and the importer untrustworthy.
 *
 * It is a liability, not a feature: raw text is unvalidated, uneditable in the
 * visual panel, and a CSS-injection vector. `serializeValue` sanitises it, and
 * the style panel must show it as read-only "custom CSS" rather than pretend to
 * understand it. Every new `raw` we are forced to emit is a bug report against
 * this model's coverage.
 */
export interface RawValue {
  readonly kind: 'raw';
  readonly value: string;
}

export type StyleValue =
  | KeywordValue
  | LengthValue
  | NumberValue
  | ColorValue
  | AngleValue
  | TimeValue
  | StringValue
  | TokenValue
  | UrlValue
  | ListValue
  | ShadowValue
  | GradientValue
  | TransformValue
  | RawValue;

/* -------------------------------------------------------------------------- */
/* Constructors                                                                */
/* -------------------------------------------------------------------------- */

export const keyword = (value: string): KeywordValue => ({ kind: 'keyword', value });

export const length = (value: number, unit: LengthUnit): LengthValue => ({
  kind: 'length',
  value,
  unit,
});

export const px = (value: number): LengthValue => length(value, 'px');
export const percent = (value: number): LengthValue => length(value, '%');
export const rem = (value: number): LengthValue => length(value, 'rem');

export const number = (value: number): NumberValue => ({ kind: 'number', value });

export const color = (value: Color): ColorValue => ({ kind: 'color', value });

export const angle = (value: number, unit: AngleUnit = 'deg'): AngleValue => ({
  kind: 'angle',
  value,
  unit,
});

export const deg = (value: number): AngleValue => angle(value, 'deg');

export const time = (value: number, unit: TimeUnit = 'ms'): TimeValue => ({
  kind: 'time',
  value,
  unit,
});

export const ms = (value: number): TimeValue => time(value, 'ms');

export const str = (value: string): StringValue => ({ kind: 'string', value });

export const token = (id: TokenId, fallback: StyleValue | null = null): TokenValue => ({
  kind: 'token',
  token: id,
  fallback,
});

export const url = (src: string, assetId: AssetId | null = null): UrlValue => ({
  kind: 'url',
  src,
  assetId,
});

export const list = (values: readonly StyleValue[], separator: ', ' | ' ' = ', '): ListValue => ({
  kind: 'list',
  values,
  separator,
});

export const raw = (value: string): RawValue => ({ kind: 'raw', value });

export const transform = (functions: readonly TransformFunction[]): TransformValue => ({
  kind: 'transform',
  functions,
});

export function shadow(options: {
  offsetX: LengthValue;
  offsetY: LengthValue;
  blur: LengthValue;
  spread?: LengthValue | null;
  color: ColorValue | TokenValue;
  inset?: boolean;
}): ShadowValue {
  return {
    kind: 'shadow',
    inset: options.inset ?? false,
    offsetX: options.offsetX,
    offsetY: options.offsetY,
    blur: options.blur,
    spread: options.spread ?? null,
    color: options.color,
  };
}

export function linearGradient(
  angleValue: AngleValue,
  stops: readonly GradientStop[],
  repeating = false,
): GradientValue {
  return { kind: 'gradient', type: 'linear', angle: angleValue, repeating, stops };
}

export function radialGradient(
  shape: 'circle' | 'ellipse',
  stops: readonly GradientStop[],
  repeating = false,
): GradientValue {
  return { kind: 'gradient', type: 'radial', shape, repeating, stops };
}

export const stop = (
  stopColor: ColorValue | TokenValue,
  position: LengthValue | null = null,
): GradientStop => ({ color: stopColor, position });

/* -------------------------------------------------------------------------- */
/* Guards                                                                      */
/* -------------------------------------------------------------------------- */

export const isKeyword = (v: StyleValue): v is KeywordValue => v.kind === 'keyword';
export const isLength = (v: StyleValue): v is LengthValue => v.kind === 'length';
export const isNumber = (v: StyleValue): v is NumberValue => v.kind === 'number';
export const isColor = (v: StyleValue): v is ColorValue => v.kind === 'color';
export const isToken = (v: StyleValue): v is TokenValue => v.kind === 'token';
export const isRaw = (v: StyleValue): v is RawValue => v.kind === 'raw';

/**
 * Does this value, or anything nested inside it, reference a design token?
 *
 * Needed to answer "what breaks if I delete this token?" before the user deletes
 * it, and to invalidate compiled CSS when a token changes. Tokens hide inside
 * shadow colours and gradient stops, so a shallow check would miss most real uses.
 */
export function referencedTokens(value: StyleValue, into: Set<TokenId> = new Set()): Set<TokenId> {
  switch (value.kind) {
    case 'token':
      into.add(value.token);
      if (value.fallback) referencedTokens(value.fallback, into);
      break;
    case 'list':
      for (const item of value.values) referencedTokens(item, into);
      break;
    case 'shadow':
      referencedTokens(value.color, into);
      break;
    case 'gradient':
      for (const gradientStop of value.stops) referencedTokens(gradientStop.color, into);
      break;
    default:
      break;
  }
  return into;
}

/**
 * Every asset referenced by this value.
 *
 * Drives "which assets does this project actually use?" — required by the
 * exporter (ship only what is referenced), the asset manager (safe delete), and
 * storage (garbage collection).
 */
export function referencedAssets(value: StyleValue, into: Set<AssetId> = new Set()): Set<AssetId> {
  switch (value.kind) {
    case 'url':
      if (value.assetId) into.add(value.assetId);
      break;
    case 'list':
      for (const item of value.values) referencedAssets(item, into);
      break;
    case 'token':
      if (value.fallback) referencedAssets(value.fallback, into);
      break;
    default:
      break;
  }
  return into;
}
