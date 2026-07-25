/**
 * PHASE F3 · Slice F — the Canvas Asset Resolver Integration (the read path).
 *
 * Slice C built the resolver and proved its object-URL lifecycle; this set proves
 * the WIRING that makes an uploaded image actually paint: the canvas consumes the
 * RESOLVED library (not the raw model one), the hook applies the resolved result,
 * and a stale in-flight resolve never clobbers a newer one. Each `find` is a single
 * line. Runs against the `web` project alone.
 */
export default {
  name: 'F3 — canvas asset resolver integration (read path)',
  testCommand: 'pnpm vitest run --project web --silent',
  mutations: [
    {
      // The canvas goes back to feeding the renderer the UNRESOLVED model library,
      // so a managed asset keeps its `asset:<id>` src and never paints.
      name: 'canvas feeds the raw model library instead of the resolved one',
      file: 'apps/web/src/Canvas.tsx',
      find: '  const assets = useResolvedAssets(resolver ?? null, present.project.assets);',
      replace: '  const assets = present.project.assets;',
    },
    {
      // The hook never applies a resolved library, so the canvas is stuck on the raw
      // one forever — the resolve runs but its result is dropped.
      name: 'hook drops the resolved library instead of applying it',
      file: 'apps/web/src/useResolvedAssets.ts',
      find: '      if (active) setResolved(next);',
      replace: '      if (active) void next;',
    },
    {
      // The staleness guard is removed, so a slow earlier resolve clobbers a newer
      // one — the race the race-safety test exists to catch.
      name: 'hook applies every resolve, even a stale superseded one',
      file: 'apps/web/src/useResolvedAssets.ts',
      find: '      if (active) setResolved(next);',
      replace: '      setResolved(next);',
    },
    {
      // The hook returns the resolved state even when there is no resolver, so before
      // any resolve the canvas would show a stale `resolved` rather than the live
      // model library — losing edits made while unresolved.
      name: 'hook returns resolved state instead of the live library without a resolver',
      file: 'apps/web/src/useResolvedAssets.ts',
      find: '  return resolver ? resolved : library;',
      replace: '  return resolved;',
    },
  ],
};
