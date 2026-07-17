/* Theme — model */
export {
  THEME_PREFERENCES,
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  resolveTheme,
  nextThemePreference,
} from './theme/theme.ts';
export type { ThemePreference, ResolvedTheme } from './theme/theme.ts';

/* Theme — injectable seams. The smallest instance of the StorageAdapter pattern
   Phase F generalises; also what lets the theme suite run with no mocking. */
export {
  THEME_STORAGE_KEY,
  createLocalStorageThemeStorage,
  createMemoryThemeStorage,
} from './theme/storage.ts';
export type { ThemeStorage } from './theme/storage.ts';

export {
  createMediaQuerySystemTheme,
  createStaticSystemTheme,
  createControllableSystemTheme,
} from './theme/systemTheme.ts';
export type { SystemThemeSource } from './theme/systemTheme.ts';

/* Theme — React */
export { ThemeProvider, ThemeContext } from './theme/ThemeProvider.tsx';
export type { ThemeProviderProps, ThemeContextValue } from './theme/ThemeProvider.tsx';
export { useTheme } from './theme/useTheme.ts';
export { ThemeToggle } from './theme/ThemeToggle.tsx';

/* Primitives */
export { Button } from './components/Button.tsx';
export type { ButtonProps, ButtonVariant, ButtonSize } from './components/Button.tsx';
export { Panel } from './components/Panel.tsx';
export type { PanelProps } from './components/Panel.tsx';

/* Layout */
export { AppShell } from './layout/AppShell.tsx';
export type { AppShellProps } from './layout/AppShell.tsx';

/* Utilities */
export { cn } from './utils/cn.ts';
export type { ClassValue } from './utils/cn.ts';
