import type { ColorMode } from '@vpb/tokens';

/**
 * Theme logic — pure, synchronous, and free of React, the DOM, and storage.
 *
 * Everything here is a total function over its arguments. That is deliberate:
 * this is the part with actual rules in it, so this is the part that must be
 * testable without mounting a component or faking a browser.
 */

/** What the *user* chose. `system` defers to the OS. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** What we actually render. `system` has been collapsed away. */
export type ResolvedTheme = ColorMode;

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/**
 * Type guard for values crossing a trust boundary (localStorage, IPC, query
 * params). Persisted state is untrusted input: a user can edit it, and an old
 * build can have written a value this build no longer understands.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** Collapse a preference plus the OS signal into the mode to render. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/**
 * Cycle order for the toggle control: light -> dark -> system -> light.
 *
 * `system` is included rather than hidden behind a settings menu because
 * "follow the OS" is a first-class choice, and a two-state toggle silently
 * strands anyone who picked it from ever getting back.
 */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  switch (current) {
    case 'light':
      return 'dark';
    case 'dark':
      return 'system';
    case 'system':
      return 'light';
  }
}
