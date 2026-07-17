import { amber, blue, common, green, neutral, red } from './palette.ts';

/**
 * Semantic tokens.
 *
 * The name describes the *role*, never the colour. `surfaceRaised` survives a
 * redesign; `zinc900` does not. This is the contract UI components code against.
 *
 * Adding a token here is a deliberate act: `tokens.test.ts` asserts that every
 * token declared in this file has a corresponding CSS custom property in
 * `theme.css` for BOTH colour modes. Drift is a test failure, not a bug report.
 */

export const SEMANTIC_TOKENS = [
  /* Surfaces */
  'surface', // application background
  'surfaceRaised', // panels, toolbars, popovers - above the app background
  'surfaceSunken', // wells; the canvas gutter the page floats in
  /* Lines */
  'border', // default separators
  'borderStrong', // emphasised separators, input outlines
  /* Text. Named `foreground` rather than `text` so the generated Tailwind
     utility reads `text-foreground` instead of the tautological `text-text`. */
  'foreground', // primary copy
  'foregroundMuted', // secondary copy, labels
  'foregroundSubtle', // tertiary copy, placeholders
  /* Accent */
  'accent',
  'accentHover',
  'accentForeground', // text/icons placed ON accent
  /* Status */
  'danger',
  'dangerForeground',
  'success',
  'warning',
  /* Editor chrome */
  'overlay', // modal scrim
  'selection', // canvas selection outline
  'ring', // keyboard focus ring
] as const;

export type SemanticToken = (typeof SEMANTIC_TOKENS)[number];

export type ColorMode = 'light' | 'dark';

export type SemanticScale = Readonly<Record<SemanticToken, string>>;

export const lightTokens: SemanticScale = {
  surface: neutral[50],
  surfaceRaised: common.white,
  surfaceSunken: neutral[100],

  border: neutral[200],
  borderStrong: neutral[300],

  foreground: neutral[900],
  foregroundMuted: neutral[500],
  foregroundSubtle: neutral[400],

  accent: blue[600],
  accentHover: blue[700],
  accentForeground: common.white,

  danger: red[600],
  dangerForeground: common.white,
  success: green[600],
  warning: amber[600],

  overlay: 'rgb(0 0 0 / 0.4)',
  selection: blue[500],
  ring: blue[500],
};

export const darkTokens: SemanticScale = {
  surface: neutral[900],
  surfaceRaised: neutral[800],
  surfaceSunken: neutral[950],

  /**
   * Must stay lighter than `surfaceRaised`. The obvious-looking `neutral[800]`
   * is exactly the value of `surfaceRaised`, which makes every panel border
   * invisible against its own background - a bug this file shipped with until a
   * running browser reported `panelBg === panelBorder`. `surfaceDistinction` in
   * tokens.test.ts now fails the build if the two ever collide again.
   */
  border: neutral[700],
  borderStrong: neutral[600],

  foreground: neutral[50],
  foregroundMuted: neutral[400],
  foregroundSubtle: neutral[500],

  accent: blue[500],
  accentHover: blue[400],
  accentForeground: common.white,

  danger: red[500],
  dangerForeground: common.white,
  success: green[500],
  warning: amber[500],

  overlay: 'rgb(0 0 0 / 0.6)',
  selection: blue[500],
  ring: blue[400],
};

export const themes: Readonly<Record<ColorMode, SemanticScale>> = {
  light: lightTokens,
  dark: darkTokens,
};

/**
 * `surfaceRaised` -> `--vpb-color-surface-raised`
 *
 * Exported (rather than inlined) because the drift test derives the expected
 * CSS property names from the token list using this exact function.
 */
export function cssVarName(token: SemanticToken): string {
  const kebab = token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return `--vpb-color-${kebab}`;
}
