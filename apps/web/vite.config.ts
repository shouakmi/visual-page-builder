import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],

  server: {
    port: 5173,
    // Fail loudly instead of silently drifting to :5174. Phase J's Electron main
    // process will load a fixed dev URL, and a moving port is a debugging tax.
    strictPort: true,
  },

  /**
   * NOTE: there is no `resolve.alias` block, and that is the point.
   *
   * `@vpb/ui` resolves because pnpm links node_modules/@vpb/ui -> packages/ui and
   * Vite reads that package's `exports` map. TypeScript resolves it the same way
   * via `moduleResolution: "bundler"`. One mechanism, no duplication, nothing to
   * keep in sync — as opposed to an alias table in Vite plus a `paths` table in
   * tsconfig that must agree forever.
   */
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    // Surface bundle regressions early rather than discovering them at Phase I.
    reportCompressedSize: true,
  },
});
