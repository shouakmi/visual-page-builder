// @vitest-environment node
//
// This suite reads index.html off disk via `import.meta.url`, which is a file://
// URL only under the node environment. The project defaults to jsdom for the
// canvas test (which renders an iframe); this file opts back out — it asserts on
// a static string and wants no DOM.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { THEME_STORAGE_KEY } from '@vpb/ui';
import { describe, expect, it } from 'vitest';

const html = await readFile(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');

/**
 * index.html contains a hand-written theme bootstrap that must run before first
 * paint, which means it cannot import anything from the bundle. That forces a
 * duplicated constant. Duplication is acceptable only when something enforces it.
 * This is that something.
 */
describe('index.html theme bootstrap', () => {
  it('uses the same storage key as @vpb/ui', () => {
    expect(
      html.includes(`'${THEME_STORAGE_KEY}'`),
      `index.html must read localStorage key "${THEME_STORAGE_KEY}" to match @vpb/ui`,
    ).toBe(true);
  });

  it('runs inline and synchronously — deferred would defeat the purpose', () => {
    const bootstrap = html.slice(0, html.indexOf('</head>'));
    expect(bootstrap).toContain('<script>');
    // A `type="module"` or `defer` script is deferred until after parsing, i.e.
    // after first paint, which is exactly the flash we are preventing.
    expect(bootstrap).not.toMatch(/<script[^>]+type=["']module["'][^>]*>/);
    expect(bootstrap).not.toMatch(/<script[^>]+\bdefer\b/);
  });

  it('honours an explicit dark preference', () => {
    expect(html).toContain("pref === 'dark'");
  });

  it('honours system preference when unset', () => {
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain("pref === 'system'");
  });

  it('cannot throw when storage is blocked', () => {
    const script = html.slice(html.indexOf('<script>'), html.indexOf('</script>'));
    expect(script).toContain('try {');
    expect(script).toContain('catch');
  });

  it('provides the #root element main.tsx mounts into', () => {
    expect(html).toContain('id="root"');
  });
});
