import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Unmount between tests.
 *
 * Vitest does not run testing-library's auto-cleanup unless globals are enabled,
 * and this project keeps globals off (every `describe`/`it` is imported
 * explicitly). Without this, each test leaves its tree mounted: the next
 * `getByRole` finds two matching elements and fails with an error that describes
 * the symptom rather than the cause.
 */
afterEach(() => {
  cleanup();
});
