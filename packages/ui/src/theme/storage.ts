import { isThemePreference, type ThemePreference } from './theme.ts';

/**
 * Where a theme preference is persisted.
 *
 * An interface rather than a direct `localStorage` call because this same UI
 * runs in three hosts with three different durable stores: the browser
 * (localStorage/IndexedDB), Electron (SQLite via IPC), and tests (memory).
 * The component must not know which one it got. This is the smallest possible
 * instance of the `StorageAdapter` seam that Phase F generalises.
 */
export interface ThemeStorage {
  read(): ThemePreference | null;
  write(preference: ThemePreference): void;
}

export const THEME_STORAGE_KEY = 'vpb.theme.preference';

/**
 * localStorage-backed storage that cannot throw.
 *
 * Every access is guarded. `localStorage` throws — not returns null, *throws* —
 * when cookies are blocked, in some private-browsing modes, inside sandboxed
 * iframes, and when the quota is exceeded. An uncaught throw here would take
 * down the whole editor at mount time, and losing a theme preference is never
 * worth a white screen. Reads that fail fall back to the default; writes that
 * fail are dropped.
 */
export function createLocalStorageThemeStorage(key: string = THEME_STORAGE_KEY): ThemeStorage {
  return {
    read() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        return isThemePreference(raw) ? raw : null;
      } catch {
        return null;
      }
    },
    write(preference) {
      try {
        globalThis.localStorage?.setItem(key, preference);
      } catch {
        /* Preference is not durable in this host. Session still works. */
      }
    },
  };
}

/** In-memory storage. Used by tests and any host without a durable store. */
export function createMemoryThemeStorage(initial: ThemePreference | null = null): ThemeStorage {
  let value = initial;
  return {
    read: () => value,
    write: (preference) => {
      value = preference;
    },
  };
}
