/**
 * The operating system's colour-scheme signal, behind an interface.
 *
 * Shaped to satisfy React's `useSyncExternalStore` contract exactly
 * (`subscribe(onChange) => unsubscribe` + a synchronous snapshot getter), so
 * the provider never has to mirror OS state into `useState` and risk tearing
 * or a stale first paint.
 */
export interface SystemThemeSource {
  /** Synchronous snapshot. Must be cheap and referentially stable in output. */
  prefersDark(): boolean;
  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(onChange: () => void): () => void;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Real implementation, backed by `matchMedia`.
 *
 * Guarded because `matchMedia` is absent in Node and in some test DOMs. Rather
 * than throwing at import time, we degrade to "light, never changes" — the
 * provider stays mountable and an explicit user preference still wins.
 */
export function createMediaQuerySystemTheme(): SystemThemeSource {
  const query = (): MediaQueryList | null => {
    if (typeof globalThis.matchMedia !== 'function') return null;
    try {
      return globalThis.matchMedia(DARK_QUERY);
    } catch {
      return null;
    }
  };

  return {
    prefersDark: () => query()?.matches ?? false,
    subscribe: (onChange) => {
      const mql = query();
      if (!mql?.addEventListener) return () => {};
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
  };
}

/** Fixed OS signal. For tests and for hosts with no media-query support. */
export function createStaticSystemTheme(prefersDark: boolean): SystemThemeSource {
  return {
    prefersDark: () => prefersDark,
    subscribe: () => () => {},
  };
}

/**
 * Controllable OS signal for tests: lets a test flip the OS to dark and assert
 * that subscribers actually re-render.
 */
export function createControllableSystemTheme(initial: boolean): SystemThemeSource & {
  set(prefersDark: boolean): void;
} {
  let prefersDark = initial;
  const listeners = new Set<() => void>();

  return {
    prefersDark: () => prefersDark,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    set: (next) => {
      prefersDark = next;
      for (const listener of listeners) listener();
    },
  };
}
