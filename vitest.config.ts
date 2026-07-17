import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * One test runner, four projects.
 *
 * Each package gets the environment it actually needs rather than paying for the
 * heaviest common denominator: `@vpb/core`, `@vpb/tokens` and `@vpb/state` are
 * pure logic, so they run in Node; `@vpb/ui`, `@vpb/renderer` and now `@vpb/web`
 * render React and need jsdom. Running the core or token suites in jsdom would
 * cost a DOM per file to test string manipulation.
 *
 * `@vpb/web` used to be node-only — it asserted on `index.html` as a string. Phase
 * D wired a live canvas into the app (`Canvas.tsx`), whose test renders it into an
 * iframe, so the project moved to jsdom. The bootstrap test still reads the HTML
 * file and is unaffected by the DOM around it.
 *
 * `state` running in **node** is a gate, not a preference: Phase C is required to
 * be headless. If a store or command ever reaches for `window`, this project is
 * where that fails.
 *
 * Defined inline rather than as per-package vitest.config.ts files so that test
 * policy is visible in one place. Revisit if a package needs genuinely bespoke
 * setup.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          root: './packages/core',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'tokens',
          root: './packages/tokens',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'state',
          root: './packages/state',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'interaction',
          root: './packages/interaction',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'renderer',
          root: './packages/renderer',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'ui',
          root: './packages/ui',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          root: './apps/web',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
    ],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'],
      exclude: ['**/__tests__/**', '**/test/**', '**/*.d.ts', '**/dev/**'],
    },
  },
});
