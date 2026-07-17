import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * One test runner, four projects.
 *
 * Each package gets the environment it actually needs rather than paying for the
 * heaviest common denominator: `@vpb/core`, `@vpb/tokens` and `@vpb/state` are
 * pure logic, so they run in Node; `@vpb/ui` renders React and needs jsdom;
 * `@vpb/web` only asserts on static assets today. Running the core or token
 * suites in jsdom would cost a DOM per file to test string manipulation.
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
        test: {
          name: 'web',
          root: './apps/web',
          environment: 'node',
          include: ['src/**/*.test.ts'],
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
