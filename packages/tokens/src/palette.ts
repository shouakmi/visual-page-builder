/**
 * Primitive palette.
 *
 * These are raw, context-free colour values. Nothing in the application should
 * ever reference a primitive directly — UI code consumes *semantic* tokens
 * (see `./semantic.ts`), which map to these per colour mode.
 *
 * The indirection is what makes retheming possible: a semantic token can be
 * repointed at a different primitive without touching a single component.
 */

export const neutral = {
  50: '#fafafa',
  100: '#f4f4f5',
  200: '#e4e4e7',
  300: '#d4d4d8',
  400: '#a1a1aa',
  500: '#71717a',
  600: '#52525b',
  700: '#3f3f46',
  800: '#27272a',
  900: '#18181b',
  950: '#09090b',
} as const;

export const blue = {
  50: '#eff6ff',
  400: '#60a5fa',
  500: '#3b82f6',
  600: '#2563eb',
  700: '#1d4ed8',
} as const;

export const red = {
  400: '#f87171',
  500: '#ef4444',
  600: '#dc2626',
} as const;

export const green = {
  500: '#22c55e',
  600: '#16a34a',
} as const;

export const amber = {
  500: '#f59e0b',
  600: '#d97706',
} as const;

export const common = {
  white: '#ffffff',
  black: '#000000',
} as const;

export const palette = { neutral, blue, red, green, amber, common } as const;

export type Palette = typeof palette;
