/**
 * PHASE F3 · Slice C — the host-side Asset Resolver's object-URL lifecycle.
 *
 * Object-URL leaks are the classic bug this layer can introduce: a URL created
 * and never revoked, created twice for one asset, or created after disposal.
 * These mutations reintroduce each failure mode and assert the lifecycle tests
 * catch it. Runs against the `web` project alone; every `find` is a single line.
 */
export default {
  name: 'F3 — asset resolver object-URL lifecycle',
  testCommand: 'pnpm vitest run --project web --silent',
  mutations: [
    {
      // No cache reuse: every resolve mints a fresh object URL for the same asset.
      name: 'resolver stops caching, so each resolve creates a new object URL',
      file: 'apps/web/src/assetResolver.ts',
      find: '    if (cached !== undefined) return cached;',
      replace: '',
    },
    {
      // Dispose stops revoking: every created URL leaks.
      name: 'dispose no longer revokes the cached object URLs',
      file: 'apps/web/src/assetResolver.ts',
      find: '      for (const pending of cache.values()) revokeEntry(pending);',
      replace: '',
    },
    {
      // The disposed guard is dropped, so a load that finishes after dispose still
      // mints an object URL — a leak the caller can never revoke.
      name: 'resolver mints an object URL even after being disposed mid-load',
      file: 'apps/web/src/assetResolver.ts',
      find: '        if (disposed || !result.ok) return null;',
      replace: '        if (!result.ok) return null;',
    },
    {
      // Eviction inverted: it revokes assets still present and keeps the dropped
      // ones — both a leak and a use-after-revoke.
      name: 'resolver evicts present assets instead of removed ones',
      file: 'apps/web/src/assetResolver.ts',
      find: '        if (!present.has(id)) {',
      replace: '        if (present.has(id)) {',
    },
    {
      // Nothing is treated as managed, so no asset is ever resolved to a blob URL.
      name: 'resolver treats every asset as external, never resolving one',
      file: 'apps/web/src/assetResolver.ts',
      find: '  return src.startsWith(MANAGED_ASSET_SCHEME);',
      replace: '  return false;',
    },
  ],
};
