import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { createLocalStorageThemeStorage, type ThemeStorage } from './storage.ts';
import { createMediaQuerySystemTheme, type SystemThemeSource } from './systemTheme.ts';
import {
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  nextThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from './theme.ts';

export interface ThemeContextValue {
  /** What the user chose — may be `system`. */
  preference: ThemePreference;
  /** What is actually rendered — never `system`. */
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  /** Advance the cycle: light -> dark -> system -> light. */
  toggle: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  children: ReactNode;
  /**
   * Where the preference is persisted. Injected so tests run without
   * localStorage and so Electron can swap in SQLite-over-IPC later.
   * Memoize if you pass this — it is a hook dependency.
   */
  storage?: ThemeStorage;
  /** OS colour-scheme signal. Injected so tests can drive it deterministically. */
  systemTheme?: SystemThemeSource;
  /**
   * Element that carries the `.dark` class. Defaults to `<html>`.
   * A function so it is evaluated after mount rather than at render.
   */
  target?: () => Element | null;
}

const defaultTarget = (): Element | null => globalThis.document?.documentElement ?? null;

export function ThemeProvider({
  children,
  storage,
  systemTheme,
  target = defaultTarget,
}: ThemeProviderProps) {
  const resolvedStorage = useMemo(() => storage ?? createLocalStorageThemeStorage(), [storage]);
  const resolvedSystem = useMemo(() => systemTheme ?? createMediaQuerySystemTheme(), [systemTheme]);

  /**
   * Lazy initialiser: reads storage exactly once, at mount, rather than on
   * every render.
   *
   * The result is re-validated here even though `createLocalStorageThemeStorage`
   * already validates. `ThemeStorage` is a public injection seam — a third-party
   * or future adapter (SQLite over IPC, a REST profile) can return anything, and
   * an unvalidated value would flow into `resolveTheme` and out as a bogus
   * resolved mode. Trust boundaries are enforced by the consumer, not assumed of
   * the provider. A `read()` that throws is likewise contained.
   */
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    try {
      const stored: unknown = resolvedStorage.read();
      return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
    } catch {
      return DEFAULT_THEME_PREFERENCE;
    }
  });

  /**
   * The OS signal is external mutable state that React does not own, which is
   * precisely what `useSyncExternalStore` exists for. The third argument is the
   * server snapshot — light, because there is no OS to ask during SSR.
   */
  const systemPrefersDark = useSyncExternalStore(
    resolvedSystem.subscribe,
    resolvedSystem.prefersDark,
    () => false,
  );

  const resolved = resolveTheme(preference, systemPrefersDark);

  /**
   * Apply first, persist second — and never let persistence failure reach the
   * user. If the durable store is full, blocked, or simply broken, the correct
   * behaviour is a theme that works for this session and is forgotten on reload,
   * not an unhandled exception thrown out of a click handler.
   */
  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(next);
      try {
        resolvedStorage.write(next);
      } catch {
        /* Not durable in this host. Session state stands. */
      }
    },
    [resolvedStorage],
  );

  const toggle = useCallback(
    () => setPreference(nextThemePreference(preference)),
    [preference, setPreference],
  );

  /**
   * Apply the resolved mode to the DOM.
   *
   * `.dark` drives the CSS custom properties in @vpb/tokens. `color-scheme` is
   * carried by the same CSS rule, so native scrollbars and form controls follow
   * without a second mechanism here.
   */
  useEffect(() => {
    const element = target();
    if (!element) return;
    element.classList.toggle('dark', resolved === 'dark');
  }, [resolved, target]);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference, toggle }),
    [preference, resolved, setPreference, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
