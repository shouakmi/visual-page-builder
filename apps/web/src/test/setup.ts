import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Unmount between tests. Same reason as `@vpb/renderer` and `@vpb/ui`: Vitest does
 * not run testing-library's auto-cleanup unless globals are enabled, and this
 * project keeps globals off. Without it each test leaves its tree — and its iframe
 * — mounted, and the next `querySelector('iframe')` finds the previous test's.
 */
afterEach(() => {
  cleanup();
});
