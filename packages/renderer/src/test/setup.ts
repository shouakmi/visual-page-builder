import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Unmount between tests. Same reason as `@vpb/ui`'s setup: Vitest does not run
 * testing-library's auto-cleanup unless globals are enabled, and this project
 * keeps globals off, so without it each test leaves its tree mounted and the next
 * query finds two matching elements.
 */
afterEach(() => {
  cleanup();
});
