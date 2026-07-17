/* Primitive palette — raw values. UI code should consume semantic tokens instead. */
export { neutral, blue, red, green, amber, common, palette } from './palette.ts';
export type { Palette } from './palette.ts';

/* Semantic scale — the contract UI components code against. */
export { SEMANTIC_TOKENS, lightTokens, darkTokens, themes, cssVarName } from './semantic.ts';
export type { SemanticToken, SemanticScale, ColorMode } from './semantic.ts';
