import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createMemoryThemeStorage, THEME_STORAGE_KEY, type ThemeStorage } from '../storage.ts';
import { createControllableSystemTheme, createStaticSystemTheme } from '../systemTheme.ts';
import { ThemeProvider } from '../ThemeProvider.tsx';
import { ThemeToggle } from '../ThemeToggle.tsx';
import {
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  nextThemePreference,
  resolveTheme,
  THEME_PREFERENCES,
  type ThemePreference,
} from '../theme.ts';
import { useTheme } from '../useTheme.ts';

/**
 * The theme suite.
 *
 * Everything here drives the real `ThemeToggle` with real clicks and keystrokes
 * and asserts on the accessible name and the class on the target element —
 * never on context internals. The injectable seams (`ThemeStorage`,
 * `SystemThemeSource`) exist precisely so this needs no mocking framework and no
 * global stubs; if a test here reaches for `vi.mock`, the seam has failed.
 *
 * Adapters are treated as untrusted throughout. A dropped theme preference must
 * never cost a white screen.
 */

/** A fresh element per test, so `.dark` assertions never leak between them. */
function renderThemed(
  ui: React.ReactNode,
  options: {
    storage?: ThemeStorage;
    systemPrefersDark?: boolean;
    systemTheme?: ReturnType<typeof createControllableSystemTheme>;
  } = {},
) {
  const target = document.createElement('div');
  document.body.append(target);

  const system = options.systemTheme ?? createStaticSystemTheme(options.systemPrefersDark ?? false);

  const result = render(
    <ThemeProvider
      storage={options.storage ?? createMemoryThemeStorage()}
      systemTheme={system}
      target={() => target}
    >
      {ui}
    </ThemeProvider>,
  );

  return { ...result, target, isDark: () => target.classList.contains('dark') };
}

const toggle = () => screen.getByRole('button');

/**
 * Collect errors that escape an event handler.
 *
 * React does not propagate a throw from a click handler back to the caller — it
 * reports it, which surfaces as an `error` event on window. So `await
 * user.click(...)` resolves happily even when the handler exploded, and a test
 * that only asserts on resulting state passes either way.
 *
 * This is not hypothetical: the first version of the write-failure test below
 * asserted exactly that, and `pnpm mutate` proved it vacuous by deleting the
 * try/catch it existed to protect and watching it pass anyway.
 */
async function errorsDuring(action: () => Promise<void>): Promise<Error[]> {
  const escaped: Error[] = [];
  const onError = (event: ErrorEvent) => {
    escaped.push(event.error as Error);
    event.preventDefault();
  };
  window.addEventListener('error', onError);
  // React routes handler errors through console.error too; keep the run quiet
  // without hiding the assertion, which reads `escaped`, not the console.
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await action();
  } finally {
    window.removeEventListener('error', onError);
    consoleError.mockRestore();
  }
  return escaped;
}

describe('resolveTheme', () => {
  it('passes an explicit preference through, whatever the OS says', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('defers to the OS only when the preference is `system`', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('never returns `system` — that is the whole point of resolving', () => {
    for (const preference of THEME_PREFERENCES) {
      for (const prefersDark of [true, false]) {
        expect(resolveTheme(preference, prefersDark)).toMatch(/^(light|dark)$/);
      }
    }
  });
});

describe('nextThemePreference', () => {
  it('cycles light -> dark -> system -> light', () => {
    expect(nextThemePreference('light')).toBe('dark');
    expect(nextThemePreference('dark')).toBe('system');
    expect(nextThemePreference('system')).toBe('light');
  });

  it('returns to the start in exactly one lap, stranding nobody', () => {
    // A cycle that cannot reach `system` silently traps anyone who picked it.
    const seen: ThemePreference[] = [];
    let current: ThemePreference = 'light';
    for (let i = 0; i < THEME_PREFERENCES.length; i++) {
      seen.push(current);
      current = nextThemePreference(current);
    }
    expect(current).toBe('light');
    expect(new Set(seen)).toEqual(new Set(THEME_PREFERENCES));
  });
});

describe('isThemePreference', () => {
  it('accepts every declared preference', () => {
    for (const preference of THEME_PREFERENCES) {
      expect(isThemePreference(preference)).toBe(true);
    }
  });

  it('rejects anything else that could cross a trust boundary', () => {
    // Persisted state is untrusted: a user can edit it, and an old build can
    // have written a value this build no longer understands.
    for (const value of [null, undefined, '', 'Dark', 'DARK', 'blue', 0, 1, {}, [], true]) {
      expect(isThemePreference(value), String(value)).toBe(false);
    }
  });
});

describe('ThemeProvider — resolution', () => {
  it('defaults to `system` when storage is empty', () => {
    renderThemed(<ThemeToggle />);
    expect(toggle()).toHaveAttribute('data-theme-preference', DEFAULT_THEME_PREFERENCE);
  });

  it('follows a dark OS when the preference is `system`', () => {
    const { isDark } = renderThemed(<ThemeToggle />, { systemPrefersDark: true });
    expect(isDark()).toBe(true);
    expect(toggle()).toHaveAttribute('data-theme-resolved', 'dark');
  });

  it('follows a light OS when the preference is `system`', () => {
    const { isDark } = renderThemed(<ThemeToggle />, { systemPrefersDark: false });
    expect(isDark()).toBe(false);
  });

  it('lets a stored preference override the OS', () => {
    const { isDark } = renderThemed(<ThemeToggle />, {
      storage: createMemoryThemeStorage('light'),
      systemPrefersDark: true,
    });
    expect(isDark()).toBe(false);
    expect(toggle()).toHaveAttribute('data-theme-preference', 'light');
  });

  it('reacts when the OS flips underneath a `system` preference', async () => {
    const system = createControllableSystemTheme(false);
    const { isDark } = renderThemed(<ThemeToggle />, { systemTheme: system });
    expect(isDark()).toBe(false);

    await vi.waitFor(() => {
      system.set(true);
      expect(isDark()).toBe(true);
    });
  });

  it('ignores an OS flip once the user has chosen explicitly', async () => {
    const user = userEvent.setup();
    const system = createControllableSystemTheme(false);
    const { isDark } = renderThemed(<ThemeToggle />, { systemTheme: system });

    await user.click(toggle()); // system -> light
    expect(toggle()).toHaveAttribute('data-theme-preference', 'light');

    system.set(true);
    expect(isDark()).toBe(false);
  });

  it('reads storage exactly once, at mount', async () => {
    const user = userEvent.setup();
    let reads = 0;
    const counting: ThemeStorage = {
      read: () => {
        reads++;
        return 'light';
      },
      write: () => {},
    };

    renderThemed(<ThemeToggle />, { storage: counting });
    expect(reads).toBe(1);

    await user.click(toggle());
    expect(reads).toBe(1);
  });
});

describe('ThemeToggle — behaviour', () => {
  it('cycles the DOM class through a full lap of clicks', async () => {
    const user = userEvent.setup();
    const { isDark } = renderThemed(<ThemeToggle />, { systemPrefersDark: false });

    // system(light) -> light
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('data-theme-preference', 'light');
    expect(isDark()).toBe(false);

    // light -> dark
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('data-theme-preference', 'dark');
    expect(isDark()).toBe(true);

    // dark -> system, which here resolves light
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('data-theme-preference', 'system');
    expect(isDark()).toBe(false);
  });

  it('is operable by keyboard', async () => {
    const user = userEvent.setup();
    renderThemed(<ThemeToggle />);

    await user.tab();
    expect(toggle()).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(toggle()).toHaveAttribute('data-theme-preference', 'light');

    await user.keyboard(' ');
    expect(toggle()).toHaveAttribute('data-theme-preference', 'dark');
  });

  it('announces both the current state and the effect of activating', () => {
    // A lone icon is meaningless to a screen reader, and "Theme" alone would not
    // tell the user what pressing it does.
    renderThemed(<ThemeToggle />, { storage: createMemoryThemeStorage('dark') });
    expect(toggle()).toHaveAccessibleName('Theme: Dark. Activate to switch.');
  });

  it('announces what `system` resolved to, not just that it is `system`', () => {
    // "System" by itself does not tell you whether you are looking at a light or
    // a dark UI.
    renderThemed(<ThemeToggle />, {
      storage: createMemoryThemeStorage('system'),
      systemPrefersDark: true,
    });
    expect(toggle()).toHaveAccessibleName('Theme: System (dark). Activate to switch.');
  });

  it('persists the choice through the storage seam', async () => {
    const user = userEvent.setup();
    const storage = createMemoryThemeStorage();
    renderThemed(<ThemeToggle />, { storage });

    await user.click(toggle());
    expect(storage.read()).toBe('light');

    await user.click(toggle());
    expect(storage.read()).toBe('dark');
  });

  it('restores the persisted choice on a fresh mount', async () => {
    const user = userEvent.setup();
    const storage = createMemoryThemeStorage();

    const first = renderThemed(<ThemeToggle />, { storage });
    await user.click(toggle()); // -> light
    await user.click(toggle()); // -> dark
    first.unmount();

    const second = renderThemed(<ThemeToggle />, { storage });
    expect(toggle()).toHaveAttribute('data-theme-preference', 'dark');
    expect(second.isDark()).toBe(true);
  });
});

/**
 * Storage is an injection seam, so an adapter is third-party code by
 * definition — a SQLite-over-IPC or REST-profile adapter can fail in ways
 * localStorage never does. Losing a theme preference is never worth a crash.
 */
describe('ThemeProvider — untrusted adapters', () => {
  it('survives storage that throws on read', () => {
    const hostile: ThemeStorage = {
      read: () => {
        throw new Error('cookies are blocked');
      },
      write: () => {},
    };
    expect(() => renderThemed(<ThemeToggle />, { storage: hostile })).not.toThrow();
    expect(toggle()).toHaveAttribute('data-theme-preference', DEFAULT_THEME_PREFERENCE);
  });

  it('survives storage that throws on write, keeping the session working', async () => {
    const user = userEvent.setup();
    const hostile: ThemeStorage = {
      read: () => null,
      write: () => {
        throw new Error('quota exceeded');
      },
    };
    const { isDark } = renderThemed(<ThemeToggle />, { storage: hostile });

    const escaped = await errorsDuring(async () => {
      await user.click(toggle()); // -> light
      await user.click(toggle()); // -> dark
    });

    // The throw must be contained, not merely survived-by-accident.
    expect(escaped.map((error) => error.message)).toEqual([]);

    // Not durable in this host, but the theme still applied for this session.
    expect(toggle()).toHaveAttribute('data-theme-preference', 'dark');
    expect(isDark()).toBe(true);
  });

  it('falls back to the default when storage returns garbage', () => {
    // An old build could have written a value this build no longer understands.
    const garbage = { read: () => 'chartreuse', write: () => {} } as unknown as ThemeStorage;
    renderThemed(<ThemeToggle />, { storage: garbage });
    expect(toggle()).toHaveAttribute('data-theme-preference', DEFAULT_THEME_PREFERENCE);
  });

  it('falls back to the default when storage returns a non-string', () => {
    const garbage = {
      read: () => ({ preference: 'dark' }),
      write: () => {},
    } as unknown as ThemeStorage;
    renderThemed(<ThemeToggle />, { storage: garbage });
    expect(toggle()).toHaveAttribute('data-theme-preference', DEFAULT_THEME_PREFERENCE);
  });
});

describe('createMemoryThemeStorage', () => {
  it('round-trips a preference', () => {
    const storage = createMemoryThemeStorage();
    expect(storage.read()).toBeNull();
    storage.write('dark');
    expect(storage.read()).toBe('dark');
  });

  it('starts from the seeded value', () => {
    expect(createMemoryThemeStorage('light').read()).toBe('light');
  });
});

describe('createLocalStorageThemeStorage', () => {
  // jsdom provides a real localStorage, so these exercise the real adapter
  // rather than a stand-in for it.
  it('round-trips through the documented key', async () => {
    const { createLocalStorageThemeStorage } = await import('../storage.ts');
    const storage = createLocalStorageThemeStorage();
    storage.write('dark');

    expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(storage.read()).toBe('dark');
    globalThis.localStorage.clear();
  });

  it('validates on the way out — a hand-edited value cannot reach the model', async () => {
    const { createLocalStorageThemeStorage } = await import('../storage.ts');
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, 'chartreuse');
    expect(createLocalStorageThemeStorage().read()).toBeNull();
    globalThis.localStorage.clear();
  });
});

describe('createStaticSystemTheme', () => {
  it('reports the fixed signal and never notifies', () => {
    const source = createStaticSystemTheme(true);
    expect(source.prefersDark()).toBe(true);
    const unsubscribe = source.subscribe(() => {
      throw new Error('a static source must never fire');
    });
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe('createControllableSystemTheme', () => {
  it('notifies subscribers on change and stops after unsubscribe', () => {
    const source = createControllableSystemTheme(false);
    let notifications = 0;
    const unsubscribe = source.subscribe(() => notifications++);

    source.set(true);
    expect(source.prefersDark()).toBe(true);
    expect(notifications).toBe(1);

    unsubscribe();
    source.set(false);
    expect(notifications).toBe(1);
  });
});

describe('useTheme', () => {
  it('throws a named error outside a provider', () => {
    // A silent fallback would render a plausible light UI that never responds to
    // the toggle — far harder to diagnose than an immediate, named error.
    function Orphan() {
      useTheme();
      return null;
    }

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(/must be called inside a <ThemeProvider>/);
    consoleError.mockRestore();
  });

  it('exposes preference, resolved and setPreference to consumers', async () => {
    const user = userEvent.setup();

    function Consumer() {
      const { preference, resolved, setPreference } = useTheme();
      return (
        <>
          <output>{`${preference}/${resolved}`}</output>
          <button type="button" onClick={() => setPreference('dark')}>
            Go dark
          </button>
        </>
      );
    }

    const target = document.createElement('div');
    document.body.append(target);
    render(
      <ThemeProvider
        storage={createMemoryThemeStorage()}
        systemTheme={createStaticSystemTheme(false)}
        target={() => target}
      >
        <Consumer />
      </ThemeProvider>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('system/light');

    await user.click(screen.getByRole('button', { name: 'Go dark' }));
    expect(screen.getByRole('status')).toHaveTextContent('dark/dark');
    expect(target.classList.contains('dark')).toBe(true);
  });
});

describe('ThemeProvider — target seam', () => {
  it('applies the class to <html> by default', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider
        storage={createMemoryThemeStorage('dark')}
        systemTheme={createStaticSystemTheme(false)}
      >
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await user.click(toggle()); // dark -> system, which resolves light here
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('does not throw when the target is absent', () => {
    // `target` is a function so it is evaluated after mount; it can legitimately
    // return null before the element exists.
    expect(() =>
      render(
        <ThemeProvider
          storage={createMemoryThemeStorage()}
          systemTheme={createStaticSystemTheme(false)}
          target={() => null}
        >
          <ThemeToggle />
        </ThemeProvider>,
      ),
    ).not.toThrow();
  });
});
