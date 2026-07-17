import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * jsdom has no `ResizeObserver`, and `SelectionLayer` constructs one to keep the
 * selection box on its element. A no-op stub lets the component mount; the box's
 * geometry is not asserted here anyway, because jsdom does no layout and every
 * `getBoundingClientRect` is zero. The overlay's behaviour that CAN be tested —
 * which nodes get a box, and that it tracks `present` — does not need real sizes.
 */
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

/**
 * Unmount between tests. Same reason as `@vpb/renderer` and `@vpb/ui`: Vitest does
 * not run testing-library's auto-cleanup unless globals are enabled, and this
 * project keeps globals off. Without it each test leaves its tree — and its iframe
 * — mounted, and the next `querySelector('iframe')` finds the previous test's.
 */
afterEach(() => {
  cleanup();
});
