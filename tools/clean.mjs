#!/usr/bin/env node
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Remove build output. Deliberately does NOT touch node_modules — `pnpm clean`
 * should be a fast, safe reset before a rebuild, not a twenty-minute reinstall.
 * Use `pnpm store prune` / delete node_modules by hand if that is what you want.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  'apps/web/dist',
  'coverage',
  'packages/tokens/dist',
  'packages/ui/dist',
  'node_modules/.vite',
];

await Promise.all(
  targets.map(async (target) => {
    await rm(join(root, target), { recursive: true, force: true });
    console.log(`removed ${target}`);
  }),
);
