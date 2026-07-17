import { describe, expect, it } from 'vitest';

import type { TokenId } from '../../identity/ids.ts';
import { hex, rgb } from '../color.ts';
import {
  escapeCssString,
  isSafeRawCss,
  isSafeUrl,
  sanitizeRawCss,
  serializeValue,
  type SerializeContext,
} from '../serialize.ts';
import {
  color,
  deg,
  keyword,
  length,
  linearGradient,
  list,
  ms,
  number,
  percent,
  px,
  raw,
  shadow,
  stop,
  str,
  token,
  transform,
  url,
} from '../values.ts';

const BRAND = (v: string) => v as TokenId;

const tokens: SerializeContext = {
  tokenVar: (id) => (id === BRAND('brand') ? 'color-brand' : null),
};

describe('scalar values', () => {
  it('serialises keywords verbatim', () => {
    expect(serializeValue(keyword('flex'))).toBe('flex');
  });

  it('serialises lengths with units', () => {
    expect(serializeValue(px(12))).toBe('12px');
    expect(serializeValue(percent(50))).toBe('50%');
    expect(serializeValue(length(1.5, 'rem'))).toBe('1.5rem');
  });

  it('drops the unit on zero, which is shorter and legal', () => {
    expect(serializeValue(px(0))).toBe('0');
    expect(serializeValue(percent(0))).toBe('0');
  });

  it('keeps the unit on 0fr — `0` and `0fr` differ to grid', () => {
    expect(serializeValue(length(0, 'fr'))).toBe('0fr');
  });

  it('never emits float artefacts', () => {
    expect(serializeValue(px(0.1 + 0.2))).toBe('0.3px');
    expect(serializeValue(number(1 / 3))).toBe('0.3333');
  });

  it('never emits exponent notation, which CSS rejects', () => {
    expect(serializeValue(px(0.0000001))).not.toContain('e');
    expect(serializeValue(number(1e21))).not.toContain('e');
    expect(serializeValue(number(1e-9))).not.toContain('e');
  });

  it('collapses a value that ROUNDS to zero to the same output as a true zero', () => {
    // Otherwise float noise upstream decides whether you get `0` or `0px`.
    expect(serializeValue(px(0.0000001))).toBe(serializeValue(px(0)));
    expect(serializeValue(px(0.0000001))).toBe('0');
  });

  it('normalises negative zero', () => {
    expect(serializeValue(px(-0))).toBe('0');
  });

  it('serialises angles and times', () => {
    expect(serializeValue(deg(45))).toBe('45deg');
    expect(serializeValue(ms(200))).toBe('200ms');
  });

  it('serialises colours', () => {
    expect(serializeValue(color(hex('#abc')))).toBe('#aabbcc');
    expect(serializeValue(color(rgb(0, 0, 0, 0.5)))).toBe('rgba(0, 0, 0, 0.5)');
  });

  it('quotes strings', () => {
    expect(serializeValue(str('Helvetica Neue'))).toBe('"Helvetica Neue"');
  });
});

describe('tokens', () => {
  it('emits var() for a known token', () => {
    expect(serializeValue(token(BRAND('brand')), tokens)).toBe('var(--color-brand)');
  });

  it('emits var() with a fallback', () => {
    expect(serializeValue(token(BRAND('brand'), px(4)), tokens)).toBe('var(--color-brand, 4px)');
  });

  /**
   * The important one. `var(--deleted)` resolves to the property's INITIAL value,
   * which for `color` is black and for `background-color` is transparent — so a
   * deleted brand token silently paints black text on a white box rather than
   * failing visibly. `unset` at least follows inheritance predictably.
   */
  it('never emits a dangling var() for an unknown token', () => {
    const out = serializeValue(token(BRAND('gone')), tokens);
    expect(out).not.toContain('var(');
    expect(out).toBe('unset');
  });

  it('prefers the fallback over `unset` when the token is unknown', () => {
    expect(serializeValue(token(BRAND('gone'), color(hex('#fff'))), tokens)).toBe('#ffffff');
  });

  it('resolves tokens nested inside shadows and gradients', () => {
    const s = shadow({
      offsetX: px(0),
      offsetY: px(2),
      blur: px(4),
      color: token(BRAND('brand')),
    });
    expect(serializeValue(s, tokens)).toContain('var(--color-brand)');
  });
});

describe('composite values', () => {
  it('serialises a box shadow with spread', () => {
    expect(
      serializeValue(
        shadow({
          offsetX: px(0),
          offsetY: px(2),
          blur: px(4),
          spread: px(1),
          color: color(rgb(0, 0, 0, 0.2)),
        }),
      ),
    ).toBe('0 2px 4px 1px rgba(0, 0, 0, 0.2)');
  });

  it('omits spread entirely when null — text-shadow rejects it', () => {
    expect(
      serializeValue(
        shadow({ offsetX: px(0), offsetY: px(1), blur: px(2), color: color(hex('#000')) }),
      ),
    ).toBe('0 1px 2px #000000');
  });

  it('serialises inset shadows', () => {
    expect(
      serializeValue(
        shadow({
          inset: true,
          offsetX: px(0),
          offsetY: px(0),
          blur: px(4),
          color: color(hex('#000')),
        }),
      ),
    ).toBe('inset 0 0 4px #000000');
  });

  it('serialises a comma list of shadows', () => {
    const a = shadow({ offsetX: px(0), offsetY: px(1), blur: px(2), color: color(hex('#000')) });
    const b = shadow({ offsetX: px(0), offsetY: px(4), blur: px(8), color: color(hex('#111')) });
    expect(serializeValue(list([a, b]))).toBe('0 1px 2px #000000, 0 4px 8px #111111');
  });

  it('serialises linear gradients with stops', () => {
    expect(
      serializeValue(
        linearGradient(deg(90), [
          stop(color(hex('#fff')), percent(0)),
          stop(color(hex('#000')), percent(100)),
        ]),
      ),
    ).toBe('linear-gradient(90deg, #ffffff 0, #000000 100%)');
  });

  it('omits a stop position when unset, letting the browser distribute', () => {
    expect(
      serializeValue(linearGradient(deg(0), [stop(color(hex('#fff'))), stop(color(hex('#000')))])),
    ).toBe('linear-gradient(0deg, #ffffff, #000000)');
  });

  it('serialises space-separated lists', () => {
    expect(serializeValue(list([px(0), keyword('auto')], ' '))).toBe('0 auto');
  });

  it('serialises an empty list as none', () => {
    expect(serializeValue(list([]))).toBe('none');
  });

  /**
   * Order is semantic. `translate() rotate()` places an element differently from
   * `rotate() translate()`, which is exactly why transform is a list and not a
   * string the resize handle overwrites.
   */
  it('preserves transform function order', () => {
    expect(
      serializeValue(
        transform([
          { fn: 'translate', x: px(10), y: px(20) },
          { fn: 'rotate', angle: deg(45) },
          { fn: 'scale', x: 1.5, y: 1.5 },
        ]),
      ),
    ).toBe('translate(10px, 20px) rotate(45deg) scale(1.5, 1.5)');
  });

  it('serialises an empty transform as none', () => {
    expect(serializeValue(transform([]))).toBe('none');
  });

  it('serialises skew and perspective', () => {
    expect(serializeValue(transform([{ fn: 'skew', x: deg(10), y: deg(5) }]))).toBe(
      'skew(10deg, 5deg)',
    );
    expect(serializeValue(transform([{ fn: 'perspective', value: px(800) }]))).toBe(
      'perspective(800px)',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Security                                                                    */
/* -------------------------------------------------------------------------- */

describe('isSafeRawCss', () => {
  it('accepts benign CSS text', () => {
    expect(isSafeRawCss('blur(4px) saturate(180%)')).toBe(true);
    expect(isSafeRawCss('calc(100% - 20px)')).toBe(true);
  });

  it('rejects every declaration breakout', () => {
    for (const attack of [
      'red; position: fixed',
      'red} body { display: none',
      'red{',
      'red</style><script>alert(1)</script>',
      'red/* swallow the rest',
      'red*/',
    ]) {
      expect(isSafeRawCss(attack), `${attack} must be unsafe`).toBe(false);
    }
  });

  /** A `g` regex keeps `lastIndex` between calls; without a reset every other
   *  call silently returns the wrong answer. */
  it('is stable across repeated calls', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(isSafeRawCss('red; position: fixed')).toBe(false);
      expect(isSafeRawCss('blur(4px)')).toBe(true);
    }
  });
});

describe('sanitizeRawCss', () => {
  it('neutralises a declaration breakout', () => {
    expect(sanitizeRawCss('red; position: fixed')).toBe('red position: fixed');
  });

  it('neutralises a rule breakout', () => {
    const out = sanitizeRawCss('red} body { display: none');
    expect(out).not.toContain('}');
    expect(out).not.toContain('{');
  });

  it('neutralises a style-tag escape', () => {
    const out = sanitizeRawCss('red</style><script>alert(1)</script>');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
  });

  it('leaves legitimate backslash escapes alone', () => {
    expect(sanitizeRawCss('\\201C')).toBe('\\201C');
  });
});

describe('serializeValue — raw is sanitised on the render path', () => {
  it('sanitises even though validation should have caught it upstream', () => {
    const out = serializeValue(raw('red; position: fixed; top: 0'));
    expect(out).not.toContain(';');
  });

  it('cannot break out of a declaration it is embedded in', () => {
    const emitted = `color: ${serializeValue(raw('red} body{display:none} .x{'))};`;
    // Exactly one declaration terminator — the one we added ourselves.
    expect(emitted.split(';')).toHaveLength(2);
    expect(emitted).not.toContain('}');
  });
});

describe('isSafeUrl', () => {
  it('allows http, https, blob, and relative URLs', () => {
    for (const src of [
      'https://cdn.example.com/a.png',
      'http://example.com/a.png',
      'blob:https://app.local/abc-123',
      '/assets/hero.webp',
      'assets/hero.webp',
      '../up/one.png',
    ]) {
      expect(isSafeUrl(src), `${src} should be safe`).toBe(true);
    }
  });

  it('allows data: for rasters and fonts', () => {
    expect(isSafeUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isSafeUrl('data:font/woff2;base64,d09GMg==')).toBe(true);
  });

  /**
   * `data:image/svg+xml` is the trap. It looks like an image and reads like one
   * in a code review, but SVG is a document format that can carry <script>. An
   * inline SVG background is a real, exploited XSS technique — and this project
   * is specified to import arbitrary third-party websites.
   */
  it('rejects data:image/svg+xml despite it being an image type', () => {
    expect(isSafeUrl('data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==')).toBe(false);
  });

  it('rejects script-bearing and document schemes', () => {
    for (const src of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'about:blank',
    ]) {
      expect(isSafeUrl(src), `${src} must be rejected`).toBe(false);
    }
  });

  /**
   * Browsers strip control characters from URLs BEFORE resolving the scheme, so
   * these all navigate as `javascript:` even though a naive scheme check reads
   * them as `java`.
   */
  it('rejects schemes obfuscated with control characters', () => {
    expect(isSafeUrl('java\u0000script:alert(1)')).toBe(false);
    expect(isSafeUrl('java\tscript:alert(1)')).toBe(false);
    expect(isSafeUrl('java\nscript:alert(1)')).toBe(false);
    expect(isSafeUrl('java\rscript:alert(1)')).toBe(false);
    expect(isSafeUrl('\u0001javascript:alert(1)')).toBe(false);
  });

  /**
   * A space is NOT a control character and is deliberately allowed. Browsers
   * percent-encode it rather than stripping it, so it cannot smuggle a scheme —
   * and users really do drag in files called "Screen Shot 2024.png". Rejecting
   * those would be a false positive on real content in exchange for no security.
   */
  it('allows spaces in filenames', () => {
    expect(isSafeUrl('assets/Screen Shot 2024.png')).toBe(true);
    expect(isSafeUrl('https://cdn.example.com/my image.png')).toBe(true);
  });

  it('treats a space-broken scheme as a harmless relative path', () => {
    // Resolves to a 404, not to `javascript:`.
    expect(isSafeUrl('java script:alert(1)')).toBe(true);
  });

  it('rejects empty and whitespace-only URLs', () => {
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl('   ')).toBe(false);
  });
});

describe('serializeValue — url fails closed', () => {
  it('emits an unsafe URL as `none`, not as a smaller exploit', () => {
    expect(serializeValue(url('javascript:alert(1)'))).toBe('none');
    expect(serializeValue(url('data:image/svg+xml,<svg onload=alert(1)>'))).toBe('none');
  });

  it('quotes and escapes a safe URL', () => {
    expect(serializeValue(url('https://x.com/a.png'))).toBe('url("https://x.com/a.png")');
  });

  it('escapes quotes that would close the url() string', () => {
    const out = serializeValue(url('https://x.com/a.png?q="onerror='));
    expect(out).toContain('\\"');
  });
});

describe('escapeCssString', () => {
  it('escapes backslashes and quotes', () => {
    expect(escapeCssString('a"b')).toBe('a\\"b');
    expect(escapeCssString('a\\b')).toBe('a\\\\b');
  });

  it('escapes newlines, which terminate a CSS string', () => {
    expect(escapeCssString('a\nb')).toBe('a\\A b');
  });

  it('escapes `<` so the text can never spell </style> when inlined into HTML', () => {
    expect(escapeCssString('</style>')).not.toContain('<');
  });

  /**
   * The invariant here is NOT "the output contains no `;` or `}`".
   *
   * Inside a quoted CSS string those characters are ordinary text with no
   * syntactic power — `font-family: "a; }"` is one perfectly well-formed
   * declaration whose value is a silly font name. Asserting on their absence
   * would be testing the wrong property and would fail on legitimate content.
   *
   * What actually matters is that the attacker cannot CLOSE the string: every
   * interior quote must be escaped, so the parser never returns to a context
   * where `;` and `}` mean anything.
   */
  it('a hostile font name cannot close the quoted string it lives in', () => {
    const hostile = 'a"; } body { display: none; } .x { color: "red';
    const emitted = serializeValue(str(hostile));

    expect(emitted.startsWith('"')).toBe(true);
    expect(emitted.endsWith('"')).toBe(true);

    // No unescaped quote anywhere between the delimiters.
    const interior = emitted.slice(1, -1);
    expect(interior).not.toMatch(/(?<!\\)"/);

    // And the payload survives intact — we escaped it, we did not corrupt it.
    expect(interior).toContain('body');
  });
});
