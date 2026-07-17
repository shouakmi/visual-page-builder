/**
 * PHASE A — tokens and theming.
 *
 * These two suites were destroyed in the 2026-07-17 incident and rewritten from
 * the architecture rather than recovered, which makes them exactly the kind of
 * tests worth distrusting: they were written against code that already passed
 * them. Every mutation below is a bug the rewritten suites claim to prevent —
 * including the `border`/`surfaceRaised` collision that actually shipped, and
 * the storage-throws crash the provider is guarded against.
 *
 * If one goes STALE the code moved — re-point it rather than deleting it, or the
 * guarantee quietly disappears.
 */
export default {
  name: 'A — tokens & theming',
  testCommand: 'pnpm vitest run --project tokens --project ui --silent',
  mutations: [
    /* ---- the token contract: TS <-> CSS ------------------------------- */
    {
      // THE BUG THAT SHIPPED. `border` and `surfaceRaised` both neutral[800] in
      // dark mode makes every panel border invisible against its own background.
      // Two differently-named tokens, sensibly assigned; only a running browser
      // reporting panelBg === panelBorder ever caught it.
      name: 'dark border collides with surfaceRaised (the bug that shipped)',
      file: 'packages/tokens/src/semantic.ts',
      find: '  border: neutral[700],',
      replace: '  border: neutral[800],',
    },
    {
      // Drift is silent: the CSS still parses, everything still compiles, and
      // the UI paints a colour the TypeScript half does not know about.
      name: 'theme.css value drifts from semantic.ts',
      file: 'packages/tokens/src/theme.css',
      find: '  --vpb-color-accent: #2563eb; /* blue.600 */',
      replace: '  --vpb-color-accent: #2563ec; /* blue.600 */',
    },
    {
      name: 'token declared in TS but missing from theme.css',
      file: 'packages/tokens/src/theme.css',
      find: '  --vpb-color-ring: #3b82f6; /* blue.500 */\n',
      replace: '',
    },
    {
      // The other direction: a property left behind by a deleted token reads as
      // live API to the next person who greps for it.
      name: 'theme.css declares a property with no token behind it',
      file: 'packages/tokens/src/theme.css',
      find: '  color-scheme: light;',
      replace: '  --vpb-color-legacy-accent: #ff0000;\n  color-scheme: light;',
    },
    {
      // Scrollbars and form controls are painted by the browser, not by us.
      // Without color-scheme they stay light inside a dark editor.
      name: 'color-scheme dropped from the dark block',
      file: 'packages/tokens/src/theme.css',
      find: '\n  color-scheme: dark;',
      replace: '',
    },
    {
      name: 'cssVarName stops kebab-casing (surfaceraised != surface-raised)',
      file: 'packages/tokens/src/semantic.ts',
      find: '  const kebab = token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);',
      replace: '  const kebab = token.toLowerCase();',
    },

    /* ---- theme resolution --------------------------------------------- */
    {
      name: 'resolveTheme ignores the OS signal under `system`',
      file: 'packages/ui/src/theme/theme.ts',
      find: "  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';",
      replace: "  if (preference === 'system') return 'light';",
    },
    {
      name: 'resolveTheme inverts the OS signal',
      file: 'packages/ui/src/theme/theme.ts',
      find: "  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';",
      replace: "  if (preference === 'system') return systemPrefersDark ? 'light' : 'dark';",
    },
    {
      // A two-state toggle silently strands anyone who picked `system` from ever
      // getting back to it.
      name: 'toggle cycle skips `system`, stranding the user',
      file: 'packages/ui/src/theme/theme.ts',
      find: "    case 'dark':\n      return 'system';",
      replace: "    case 'dark':\n      return 'light';",
    },
    {
      name: 'isThemePreference accepts any string',
      file: 'packages/ui/src/theme/theme.ts',
      find: "  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);",
      replace: "  return typeof value === 'string';",
    },

    /* ---- the storage seam: adapters are untrusted ---------------------- */
    {
      // localStorage THROWS — not returns null — when cookies are blocked, in
      // some private modes, and in sandboxed iframes. Uncaught, this is a white
      // screen at mount over a lost theme preference.
      name: 'provider does not contain a storage read that throws',
      file: 'packages/ui/src/theme/ThemeProvider.tsx',
      find: '    try {\n      const stored: unknown = resolvedStorage.read();\n      return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;\n    } catch {\n      return DEFAULT_THEME_PREFERENCE;\n    }',
      replace:
        '    const stored: unknown = resolvedStorage.read();\n    return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;',
    },
    {
      // A full or blocked store must cost the preference, not throw out of a
      // click handler.
      name: 'provider does not contain a storage write that throws',
      file: 'packages/ui/src/theme/ThemeProvider.tsx',
      find: '      try {\n        resolvedStorage.write(next);\n      } catch {\n        /* Not durable in this host. Session state stands. */\n      }',
      replace: '      resolvedStorage.write(next);',
    },
    {
      // ThemeStorage is a public seam: a future SQLite-over-IPC adapter can
      // return anything, and an unvalidated value flows straight into
      // resolveTheme and out as a bogus resolved mode.
      name: 'provider trusts whatever storage returns',
      file: 'packages/ui/src/theme/ThemeProvider.tsx',
      find: '      return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;',
      replace: '      return (stored ?? DEFAULT_THEME_PREFERENCE) as ThemePreference;',
    },
    {
      name: 'localStorage adapter returns a hand-edited value unvalidated',
      file: 'packages/ui/src/theme/storage.ts',
      find: '        return isThemePreference(raw) ? raw : null;',
      replace: '        return (raw ?? null) as ThemePreference | null;',
    },

    /* ---- applying the mode to the DOM --------------------------------- */
    {
      name: 'dark class is added but never removed',
      file: 'packages/ui/src/theme/ThemeProvider.tsx',
      find: "    element.classList.toggle('dark', resolved === 'dark');",
      replace: "    element.classList.add('dark');",
    },
    {
      // `target` is evaluated after mount and can legitimately return null.
      name: 'missing-target guard removed',
      file: 'packages/ui/src/theme/ThemeProvider.tsx',
      find: '    if (!element) return;\n',
      replace: '',
    },

    /* ---- the control -------------------------------------------------- */
    {
      // A lone icon is meaningless to a screen reader, and "Theme" alone does
      // not tell the user what pressing it does.
      name: 'toggle loses its stateful accessible name',
      file: 'packages/ui/src/theme/ThemeToggle.tsx',
      find: '      aria-label={`Theme: ${state}. Activate to switch.`}',
      replace: '      aria-label="Theme"',
    },
    {
      // "System" by itself does not tell you whether you are looking at a light
      // or a dark UI.
      name: 'toggle stops announcing what `system` resolved to',
      file: 'packages/ui/src/theme/ThemeToggle.tsx',
      find: "  const state = preference === 'system' ? `System (${resolved})` : LABELS[preference];",
      replace: '  const state = LABELS[preference];',
    },
    {
      // A silent fallback renders a plausible light UI that never responds to
      // the toggle — far harder to diagnose than an immediate, named error.
      name: 'useTheme falls back silently outside a provider',
      file: 'packages/ui/src/theme/useTheme.ts',
      find: "  if (context === null) {\n    throw new Error('useTheme() must be called inside a <ThemeProvider>.');\n  }\n  return context;",
      replace:
        "  return (\n    context ?? {\n      preference: 'system',\n      resolved: 'light',\n      setPreference: () => {},\n      toggle: () => {},\n    }\n  );",
    },
  ],
};
