import type { AssetLibrary } from '@vpb/core';
import { useEffect, useState } from 'react';

import type { AssetResolver } from './assetResolver.ts';

/**
 * Drive the host asset resolver from the live model library (Phase F3, Slice F).
 *
 * The resolver (Slice C) bridges a managed asset's opaque `asset:<id>` src to a
 * live `blob:` URL; this hook is what actually asks it to, on every library
 * change, and hands the caller the RESOLVED library so uploaded images paint.
 *
 * WHY A HOOK, not a value in `useMemo`: `resolve` is async (it loads bytes), so
 * the resolved library cannot exist during the render that first sees a new one.
 * The raw library is returned until the resolve lands, then the resolved one — an
 * uploaded image simply appears a tick later, which is the honest shape of a load.
 *
 * MEMOISATION: between edits that do not touch assets, `library` keeps its
 * identity (the store spreads `assets` through untouched), so no resolve runs and
 * the returned value is referentially stable — the reconciler still sees a stable
 * `env`. A resolve produces a new library ONLY when the model library changed,
 * which is exactly when `env` should change.
 *
 * NO RESOLVER (no storage adapter): there are no managed assets to resolve, so the
 * model library is returned as-is — external assets already carry a loadable src.
 */
export function useResolvedAssets(
  resolver: AssetResolver | null,
  library: AssetLibrary,
): AssetLibrary {
  const [resolved, setResolved] = useState<AssetLibrary>(library);

  useEffect(() => {
    if (!resolver) return;
    let active = true;
    void resolver.resolve(library).then((next) => {
      // A newer library superseded this resolve (its effect was torn down, flipping
      // `active`), or the hook unmounted, before it landed: dropping it is what keeps
      // a slow resolve from clobbering a newer one.
      if (active) setResolved(next);
    });
    return () => {
      active = false;
    };
  }, [resolver, library]);

  // Without a resolver the model library IS the resolved library, always current.
  return resolver ? resolved : library;
}
