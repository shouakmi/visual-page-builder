import type { TokenId } from '../identity/ids.ts';
import { formatColor } from './color.ts';
import { formatNumber } from './units.ts';
import type {
  GradientStop,
  GradientValue,
  ShadowValue,
  StyleValue,
  TransformFunction,
  TransformValue,
} from './values.ts';

/**
 * Turning a StyleValue into CSS text.
 *
 * This is the ONLY place a style value becomes a string. Centralising it makes
 * escaping a property of the system rather than something each call site has to
 * remember — the prototype interpolated user data straight into a stylesheet with
 * `${k}="${String(v)}"` and inherited an injection hole everywhere it did so.
 */

export interface SerializeContext {
  /**
   * Resolve a token to its CSS custom-property name, WITHOUT the `var()` wrapper
   * or the leading `--`. Returning `null` means "unknown token": the serialiser
   * then emits the fallback rather than a dangling `var(--gone)`.
   *
   * Injected because the token table is project state (Phase K), and this module
   * must stay a pure function of its inputs.
   */
  tokenVar(id: TokenId): string | null;
}

const NO_TOKENS: SerializeContext = { tokenVar: () => null };

/* -------------------------------------------------------------------------- */
/* Sanitisation                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Sequences that let a declaration VALUE escape its own declaration.
 *
 * Inside `prop: <value>`, these are the breakouts that matter:
 *   `;`  ends the declaration and starts another  -> `red; position: fixed`
 *   `}`  closes the rule entirely                 -> `red} body { display: none`
 *   `{`  opens a block
 *   `<`  can spell `</style>` and escape into HTML when the CSS is inlined
 *   `/`+`*`  opens a comment that swallows every rule that follows
 *
 * CSS escape sequences (`\3b`) are deliberately NOT treated as breakouts: an
 * escaped semicolon is part of an identifier, not a declaration separator. So
 * backslashes survive and legitimate escapes (`content: "\201C"`) keep working.
 */
const CSS_VALUE_BREAKOUT = /[;{}<>]|\/\*|\*\//g;

/** True when the text is safe to emit verbatim as a declaration value. */
export function isSafeRawCss(value: string): boolean {
  // `g` regexes carry lastIndex across calls; reset or every other test lies.
  CSS_VALUE_BREAKOUT.lastIndex = 0;
  return !CSS_VALUE_BREAKOUT.test(value);
}

/**
 * Strip breakout sequences from raw CSS text.
 *
 * Strips rather than throws: this runs on the render path, and a malformed value
 * must degrade to a harmless declaration, never take down the editor. Validation
 * belongs upstream (`isSafeRawCss` at authoring/import time); this is defence in
 * depth, not the only line.
 */
export function sanitizeRawCss(value: string): string {
  return value.replace(CSS_VALUE_BREAKOUT, '').trim();
}

/**
 * Schemes permitted in `url()`.
 *
 * An allowlist, never a blocklist. A blocklist loses to the next scheme somebody
 * invents, and to every encoding trick against the ones it names. URLs with no
 * scheme are relative, resolved against the document, and always fine.
 */
const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:', 'blob:']);

/**
 * `data:` is allowed ONLY for rasters and fonts.
 *
 * `data:text/html` is obvious. `data:image/svg+xml` is the non-obvious one and is
 * deliberately absent: SVG is a document format that can carry <script>, and an
 * inline SVG background is a real, exploited XSS technique. Rasters and fonts
 * cannot execute. This matters the moment we honour the spec's "import any
 * website" requirement and start ingesting third-party CSS.
 */
const ALLOWED_DATA_PREFIXES = [
  'data:image/png',
  'data:image/jpeg',
  'data:image/jpg',
  'data:image/gif',
  'data:image/webp',
  'data:image/avif',
  'data:font/',
  'data:application/font-woff',
];

/**
 * Control characters, which browsers strip from URLs *before* resolving the
 * scheme. `java\0script:`, `java\tscript:`, and `java\nscript:` all navigate as
 * `javascript:` — so a scheme check against the raw string is inspecting a
 * different string than the browser will act on.
 *
 * The SPACE character is deliberately NOT in this set. It is stripped from
 * neither position: a space is percent-encoded, so `java script:` stays a
 * (harmless, relative) `java script:` rather than collapsing to `javascript:`.
 * Including U+0020 here would buy no security and would reject every legitimate
 * `Screen Shot 2024.png` a user drags in — a false positive on real content is a
 * worse bug than the imaginary attack it prevents.
 */
// eslint-disable-next-line no-control-regex
const URL_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function isSafeUrl(src: string): boolean {
  const value = src.trim();
  if (value === '') return false;
  if (URL_CONTROL_CHARS.test(value)) return false;

  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (!scheme) return true; // relative

  const lower = value.toLowerCase();
  if (lower.startsWith('data:')) {
    return ALLOWED_DATA_PREFIXES.some((prefix) => lower.startsWith(prefix));
  }
  return ALLOWED_URL_SCHEMES.has(`${scheme[1]?.toLowerCase()}:`);
}

/** Escape a string for use inside a CSS double-quoted string. */
export function escapeCssString(value: string): string {
  return (
    value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      // A literal newline terminates a CSS string; `\A ` is the escaped form.
      .replace(/\n/g, '\\A ')
      .replace(/\r/g, '')
      // Escaped so the text can never spell `</style>` when the CSS is inlined
      // into an HTML document, which the exporter does.
      .replace(/</g, '\\3c ')
  );
}

/* -------------------------------------------------------------------------- */
/* Serialisation                                                               */
/* -------------------------------------------------------------------------- */

function serializeShadow(value: ShadowValue, ctx: SerializeContext): string {
  const parts: string[] = [];
  if (value.inset) parts.push('inset');
  parts.push(serializeValue(value.offsetX, ctx));
  parts.push(serializeValue(value.offsetY, ctx));
  parts.push(serializeValue(value.blur, ctx));
  // Omitted, not zeroed: `text-shadow` rejects a spread entirely, and a stray
  // `0` there invalidates the whole declaration.
  if (value.spread) parts.push(serializeValue(value.spread, ctx));
  parts.push(serializeValue(value.color, ctx));
  return parts.join(' ');
}

function serializeStop(value: GradientStop, ctx: SerializeContext): string {
  const colorText = serializeValue(value.color, ctx);
  return value.position ? `${colorText} ${serializeValue(value.position, ctx)}` : colorText;
}

function serializeGradient(value: GradientValue, ctx: SerializeContext): string {
  const stops = value.stops.map((s) => serializeStop(s, ctx)).join(', ');
  const prefix = value.repeating ? 'repeating-' : '';

  if (value.type === 'linear') {
    return `${prefix}linear-gradient(${serializeValue(value.angle, ctx)}, ${stops})`;
  }
  return `${prefix}radial-gradient(${value.shape}, ${stops})`;
}

function serializeTransformFunction(fn: TransformFunction, ctx: SerializeContext): string {
  const v = (value: StyleValue) => serializeValue(value, ctx);
  const n = formatNumber;

  switch (fn.fn) {
    case 'translate':
      return `translate(${v(fn.x)}, ${v(fn.y)})`;
    case 'translateX':
    case 'translateY':
    case 'translateZ':
      return `${fn.fn}(${v(fn.value)})`;
    case 'scale':
      return `scale(${n(fn.x)}, ${n(fn.y)})`;
    case 'scaleX':
    case 'scaleY':
      return `${fn.fn}(${n(fn.value)})`;
    case 'rotate':
    case 'rotateX':
    case 'rotateY':
    case 'rotateZ':
      return `${fn.fn}(${v(fn.angle)})`;
    case 'skew':
      return `skew(${v(fn.x)}, ${v(fn.y)})`;
    case 'skewX':
    case 'skewY':
      return `${fn.fn}(${v(fn.angle)})`;
    case 'perspective':
      return `perspective(${v(fn.value)})`;
  }
}

function serializeTransform(value: TransformValue, ctx: SerializeContext): string {
  if (value.functions.length === 0) return 'none';
  return value.functions.map((fn) => serializeTransformFunction(fn, ctx)).join(' ');
}

/**
 * Serialise a style value to CSS text.
 *
 * Total: every variant is handled, and the `never` assignment at the bottom makes
 * adding a variant without handling it a COMPILE error rather than an
 * `undefined` that reaches a stylesheet at runtime.
 */
export function serializeValue(value: StyleValue, ctx: SerializeContext = NO_TOKENS): string {
  switch (value.kind) {
    case 'keyword':
      return value.value;

    case 'length': {
      /**
       * Test the FORMATTED number, not the raw one.
       *
       * `formatNumber` rounds to 4dp, so 0.0000001px rounds to zero — and
       * checking `value.value === 0` would emit `0px` for it while emitting `0`
       * for a true zero. Same quantity, two spellings, depending on float noise
       * upstream. Formatting first makes the output a function of what we
       * actually print.
       *
       * `0` is unitless-legal and shorter — but NOT for `fr`, where `0` and `0fr`
       * mean different things to grid track sizing.
       */
      const formatted = formatNumber(value.value);
      return formatted === '0' && value.unit !== 'fr' ? '0' : `${formatted}${value.unit}`;
    }

    case 'number':
      return formatNumber(value.value);

    case 'color':
      return formatColor(value.value);

    case 'angle':
      return `${formatNumber(value.value)}${value.unit}`;

    case 'time':
      return `${formatNumber(value.value)}${value.unit}`;

    case 'string':
      return `"${escapeCssString(value.value)}"`;

    case 'token': {
      const name = ctx.tokenVar(value.token);
      if (name === null) {
        // Unknown token: emit the fallback, else `unset` and let the cascade
        // decide. Never emit `var(--missing)` — that resolves to the property's
        // *initial* value, which paints black text on a black box where a brand
        // colour used to be. `unset` degrades to inherited/initial predictably.
        return value.fallback ? serializeValue(value.fallback, ctx) : 'unset';
      }
      return value.fallback
        ? `var(--${name}, ${serializeValue(value.fallback, ctx)})`
        : `var(--${name})`;
    }

    case 'url':
      // Fail closed. An unsafe URL becomes no image, not a smaller exploit.
      return isSafeUrl(value.src) ? `url("${escapeCssString(value.src)}")` : 'none';

    case 'list':
      if (value.values.length === 0) return 'none';
      return value.values.map((item) => serializeValue(item, ctx)).join(value.separator);

    case 'shadow':
      return serializeShadow(value, ctx);

    case 'gradient':
      return serializeGradient(value, ctx);

    case 'transform':
      return serializeTransform(value, ctx);

    case 'raw':
      return sanitizeRawCss(value.value);

    default: {
      const exhaustive: never = value;
      throw new Error(`Unhandled style value: ${JSON.stringify(exhaustive)}`);
    }
  }
}
