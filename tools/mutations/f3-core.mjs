/**
 * PHASE F3 · Slice A — core asset usage tracking.
 *
 * `usedAssets` completed to scan style rules (not just node props), and the new
 * `orphanedAssets`. The headline mutation is the one that reintroduces the
 * data-loss bug the design review caught: dropping the stylesheet scan, which
 * makes a background-image asset look unused and hands it to a delete sweep.
 * Runs against the `core` project alone; every `find` is a single line.
 */
export default {
  name: 'F3 — core asset usage (usedAssets, orphanedAssets)',
  testCommand: 'pnpm vitest run --project core --silent',
  mutations: [
    {
      // THE data-loss mutation. Without the stylesheet scan, an asset referenced
      // only by a class/node-local `background-image` is reported unused, and
      // orphan detection would offer the user's live asset for deletion.
      name: 'usedAssets stops scanning style rules, so a background-image asset looks unused',
      file: 'packages/core/src/document/project.ts',
      find: '      if (value) referencedStyleAssets(value, out);',
      replace: '',
    },
    {
      // The favicon / ogImage half of the same completeness guarantee.
      name: 'usedAssets stops scanning favicon and ogImage',
      file: 'packages/core/src/document/project.ts',
      find: '    if (asset) out.add(asset);',
      replace: '',
    },
    {
      // Inverting the filter turns orphanedAssets into "used assets", so it would
      // report every in-use asset as deletable and hide the actually-unused ones.
      name: 'orphanedAssets reports used assets instead of unused',
      file: 'packages/core/src/document/project.ts',
      find: '  return allAssets(project.assets).filter((asset) => !used.has(asset.id));',
      replace: '  return allAssets(project.assets).filter((asset) => used.has(asset.id));',
    },
    {
      // An empty "used" set makes every asset look orphaned — every live asset
      // becomes a deletion candidate.
      name: 'orphanedAssets ignores usedAssets, treating every asset as unused',
      file: 'packages/core/src/document/project.ts',
      find: '  const used = new Set<AssetId>(usedAssets(project));',
      replace: '  const used = new Set<AssetId>();',
    },
  ],
};
