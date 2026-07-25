import {
  createAssetLibrary,
  unsafeId,
  type Asset,
  type AssetId,
  type AssetLibrary,
} from '@vpb/core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AssetResolver } from '../assetResolver.ts';
import { useResolvedAssets } from '../useResolvedAssets.ts';

/**
 * Phase F3, Slice F — the hook that drives the resolver from the model library.
 *
 * The resolver's own object-URL lifecycle is tested in `assetResolver.test.ts`;
 * this covers the REACTIVE seam the canvas depends on: raw until resolved, the
 * resolved library once it lands, pass-through without a resolver, and — the one
 * that bites in a real app — a slow earlier resolve never clobbering a newer one.
 */

const asset = (id: string, src: string): Asset => ({
  id: unsafeId<AssetId>(id),
  name: `${id}.png`,
  mimeType: 'image/png',
  byteSize: 1,
  src,
  createdAt: '2026-07-24T00:00:00.000Z',
});

/** A resolver that returns a fixed library immediately. */
function immediateResolver(resolved: AssetLibrary): AssetResolver {
  return { resolve: async () => resolved, dispose: () => {} };
}

describe('useResolvedAssets', () => {
  it('returns the model library unchanged when there is no resolver', () => {
    const library = createAssetLibrary([asset('a', 'asset:a')]);
    const { result, rerender } = renderHook(({ lib }) => useResolvedAssets(null, lib), {
      initialProps: { lib: library },
    });

    // Same reference: env memoisation depends on it not being rewrapped.
    expect(result.current).toBe(library);

    const next = createAssetLibrary([asset('a', 'asset:a'), asset('b', 'asset:b')]);
    rerender({ lib: next });
    expect(result.current).toBe(next);
  });

  it('shows the raw library until the resolve lands, then the resolved one', async () => {
    const raw = createAssetLibrary([asset('a', 'asset:a')]);
    const resolvedLib = createAssetLibrary([asset('a', 'blob:mock/a')]);
    const { result } = renderHook(() => useResolvedAssets(immediateResolver(resolvedLib), raw));

    // Before the async resolve completes, the raw library is the honest answer.
    expect(result.current).toBe(raw);

    await act(async () => {}); // flush the resolve microtask + effect
    expect(result.current).toBe(resolvedLib);
    expect(result.current.assets.get(unsafeId<AssetId>('a'))?.src).toBe('blob:mock/a');
  });

  it('does not let a slow earlier resolve clobber a newer one', async () => {
    const rawA = createAssetLibrary([asset('a', 'asset:a')]);
    const rawB = createAssetLibrary([asset('b', 'asset:b')]);
    const resolvedA = createAssetLibrary([asset('a', 'blob:a')]);
    const resolvedB = createAssetLibrary([asset('b', 'blob:b')]);

    // Hand-controlled promises, keyed by which library was passed in.
    let landA!: () => void;
    let landB!: () => void;
    const resolver: AssetResolver = {
      resolve: (library) =>
        new Promise<AssetLibrary>((res) => {
          if (library === rawA) landA = () => res(resolvedA);
          else landB = () => res(resolvedB);
        }),
      dispose: () => {},
    };

    const { result, rerender } = renderHook(({ lib }) => useResolvedAssets(resolver, lib), {
      initialProps: { lib: rawA },
    });
    // A is in flight; move to B before A lands.
    rerender({ lib: rawB });

    // B lands first and shows.
    await act(async () => {
      landB();
    });
    expect(result.current).toBe(resolvedB);

    // A's stale resolve arrives late and MUST be ignored.
    await act(async () => {
      landA();
    });
    expect(result.current).toBe(resolvedB);
  });
});
