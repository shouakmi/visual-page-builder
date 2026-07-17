import { useContext } from 'react';

import { ThemeContext, type ThemeContextValue } from './ThemeProvider.tsx';

/**
 * Access the active theme.
 *
 * Throws — rather than returning a default — when used outside a provider. A
 * silent fallback would render a plausible-looking light UI that never responds
 * to the toggle, which is far harder to diagnose than an immediate, named error.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error('useTheme() must be called inside a <ThemeProvider>.');
  }
  return context;
}
