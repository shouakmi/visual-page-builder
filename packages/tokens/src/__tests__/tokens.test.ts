import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { blue, common, neutral } from '../palette.ts';
import {
  SEMANTIC_TOKENS,
  cssVarName,
  darkTokens,
  lightTokens,
  themes,
  type ColorMode,
  type SemanticToken,
} from '../semantic.ts';

/**
 * The token contract.
 *
 * `semantic.ts` (TypeScript) and `theme.css` (custom properties) are two
 * representations of one truth, and nothing but this file holds them together.
 * Drift is silent by nature: a token added to one and forgotten in the other
 * still compiles, still passes every other test, and surfaces as an unstyled
 * panel in a build nobody connects to the edit that caused it.
 *
 * So the expectations here are *derived* from `SEMANTIC_TOKENS` rather than
 * written out. A hand-maintained list of expected properties would be a third
 * representation that can drift from the other two.
 */

const css = await readFile(fileURLToPath(new URL('../theme.css', import.meta.url)), 'utf8');

/** Strip comments first: theme.css annotates values with their primitive name. */
const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

function blockFor(selector: string): string {
  // Values contain parens (`rgb(0 0 0 / 0.4)`) but never braces, so the first
  // closing brace after the selector is genuinely the end of the block.
  const pattern = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`);
  const match = pattern.exec(withoutComments);
  if (!match?.[1]) throw new Error(`theme.css has no \`${selector}\` block`);
  return match[1];
}

function declarationsIn(selector: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const line of blockFor(selector).split(';')) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (name) declarations.set(name, value);
  }
  return declarations;
}

/** The selector carrying each mode's values. Light is the unclassed default. */
const SELECTOR: Readonly<Record<ColorMode, string>> = { light: ':root', dark: '.dark' };

const declarations: Readonly<Record<ColorMode, Map<string, string>>> = {
  light: declarationsIn(SELECTOR.light),
  dark: declarationsIn(SELECTOR.dark),
};

const MODES: readonly ColorMode[] = ['light', 'dark'];

describe('cssVarName', () => {
  it('maps a camelCase token to a kebab-case custom property', () => {
    expect(cssVarName('surfaceRaised')).toBe('--vpb-color-surface-raised');
  });

  it('leaves a single-word token alone but for the prefix', () => {
    expect(cssVarName('accent')).toBe('--vpb-color-accent');
  });

  it('is injective — no two tokens may claim one property', () => {
    // `foregroundMuted` and `foreground_muted` would collide under a sloppier
    // transform, and the loser would be silently overwritten in the cascade.
    const names = SEMANTIC_TOKENS.map(cssVarName);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe.each(MODES)('theme.css — %s mode', (mode) => {
  const selector = SELECTOR[mode];

  it(`declares every semantic token under ${SELECTOR[mode]}`, () => {
    const missing = SEMANTIC_TOKENS.filter((token) => !declarations[mode].has(cssVarName(token)));
    expect(missing, `tokens declared in semantic.ts but absent from ${selector}`).toEqual([]);
  });

  it('declares nothing that is not a semantic token', () => {
    // The other direction of drift: a property left behind by a renamed or
    // deleted token is dead weight that reads as live API to the next person.
    const expected = new Set<string>(SEMANTIC_TOKENS.map(cssVarName));
    const extra = [...declarations[mode].keys()].filter(
      (name) => name.startsWith('--vpb-color-') && !expected.has(name),
    );
    expect(extra, `properties in ${selector} with no token in semantic.ts`).toEqual([]);
  });

  it('carries the same value the TypeScript scale does', () => {
    const drifted = SEMANTIC_TOKENS.filter(
      (token) => declarations[mode].get(cssVarName(token)) !== themes[mode][token],
    ).map((token) => ({
      token,
      css: declarations[mode].get(cssVarName(token)),
      ts: themes[mode][token],
    }));
    expect(drifted, `${selector} disagrees with semantic.ts`).toEqual([]);
  });

  it(`sets color-scheme: ${mode}, so native controls follow`, () => {
    // Scrollbars, date pickers and form widgets are painted by the browser, not
    // by us. Without this they stay light inside a dark editor.
    expect(declarations[mode].get('color-scheme')).toBe(mode);
  });
});

/**
 * THE BUG THIS FILE EXISTS TO KILL.
 *
 * `border` and `surfaceRaised` were both neutral[800] in dark mode, so every
 * panel border was invisible against its own background. The code read
 * perfectly — two differently-named tokens, sensibly assigned. Only a running
 * browser reporting `panelBg === panelBorder` caught it.
 *
 * A token pair that is *rendered on top of the other* has a hard requirement no
 * naming convention can enforce: the values must differ. State it as a test.
 */
describe('surfaceDistinction', () => {
  const MUST_DIFFER: readonly (readonly [SemanticToken, SemanticToken])[] = [
    /* A border is drawn on the surface it encloses. */
    ['border', 'surface'],
    ['border', 'surfaceRaised'],
    ['border', 'surfaceSunken'],
    ['borderStrong', 'surfaceRaised'],
    /* A raised panel must read as raised off the app background, and a sunken
       well must read as sunken into it. */
    ['surface', 'surfaceRaised'],
    ['surface', 'surfaceSunken'],
    /* Text on its background. */
    ['foreground', 'surface'],
    ['foregroundMuted', 'surface'],
    ['foregroundSubtle', 'surface'],
    ['foreground', 'surfaceRaised'],
    /* Text placed ON a filled control must differ from the fill. */
    ['accentForeground', 'accent'],
    ['accentForeground', 'accentHover'],
    ['dangerForeground', 'danger'],
    /* A hover state that looks identical to rest state is not a hover state. */
    ['accent', 'accentHover'],
  ];

  describe.each(MODES)('%s mode', (mode) => {
    it.each(MUST_DIFFER)('%s is distinguishable from %s', (a, b) => {
      expect(themes[mode][a], `${a} and ${b} resolve to the same colour in ${mode} mode`).not.toBe(
        themes[mode][b],
      );
    });
  });
});

describe('semantic scale', () => {
  it('covers every declared token in both modes', () => {
    // `SemanticScale` is `Record<SemanticToken, string>`, so this cannot fail at
    // runtime without the types having been bypassed — but the object literals
    // are the thing a merge conflict mangles, and a missing key resolves to
    // `undefined` and paints nothing.
    for (const mode of MODES) {
      for (const token of SEMANTIC_TOKENS) {
        expect(themes[mode][token], `${mode}.${token}`).toBeTruthy();
      }
    }
  });

  it('exposes light and dark under `themes`', () => {
    expect(themes.light).toBe(lightTokens);
    expect(themes.dark).toBe(darkTokens);
  });

  it('resolves to primitives, never to another token', () => {
    // Values are written out rather than chained through a second var() layer so
    // DevTools shows a real colour on the computed property.
    for (const mode of MODES) {
      for (const token of SEMANTIC_TOKENS) {
        expect(themes[mode][token], `${mode}.${token}`).not.toContain('var(');
      }
    }
  });

  it('is inverted between modes on the surface/foreground axis', () => {
    // Not a style preference: if these ever agreed, one mode would be rendering
    // dark text on a dark surface.
    expect(lightTokens.surface).toBe(neutral[50]);
    expect(darkTokens.surface).toBe(neutral[900]);
    expect(lightTokens.foreground).toBe(neutral[900]);
    expect(darkTokens.foreground).toBe(neutral[50]);
  });

  it('keeps the dark-mode overlay scrim heavier than light mode', () => {
    // A scrim tuned for a light UI does not read as a scrim over a dark one.
    expect(lightTokens.overlay).toBe('rgb(0 0 0 / 0.4)');
    expect(darkTokens.overlay).toBe('rgb(0 0 0 / 0.6)');
  });

  it('uses white for text on accent in both modes', () => {
    expect(lightTokens.accentForeground).toBe(common.white);
    expect(darkTokens.accentForeground).toBe(common.white);
  });

  it('keeps selection stable across modes but lifts the focus ring in dark', () => {
    expect(lightTokens.selection).toBe(blue[500]);
    expect(darkTokens.selection).toBe(blue[500]);
    expect(lightTokens.ring).toBe(blue[500]);
    expect(darkTokens.ring).toBe(blue[400]);
  });
});

describe('palette', () => {
  it('is context-free: every primitive is a literal colour', () => {
    for (const [name, value] of Object.entries({ ...neutral, ...blue, ...common })) {
      expect(value, name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('orders the neutral ramp from lightest to darkest', () => {
    // The semantic scale assumes this ordering when it picks a border one step
    // off a surface. If the ramp were unordered, `neutral[700]` vs
    // `neutral[800]` would carry no guarantee of contrast.
    const luminance = (hex: string): number => {
      const int = Number.parseInt(hex.slice(1), 16);
      return ((int >> 16) & 0xff) + ((int >> 8) & 0xff) + (int & 0xff);
    };
    const steps = Object.entries(neutral)
      .map(([step, hex]) => ({ step: Number(step), luminance: luminance(hex) }))
      .sort((a, b) => a.step - b.step);

    for (let i = 1; i < steps.length; i++) {
      const previous = steps[i - 1];
      const current = steps[i];
      if (!previous || !current) throw new Error('unreachable');
      expect(
        current.luminance,
        `neutral[${current.step}] must be darker than [${previous.step}]`,
      ).toBeLessThan(previous.luminance);
    }
  });
});
