import {
  IMAGE_COMPONENT_ID,
  createAssetLibrary,
  createBuiltinRegistry,
  createIdFactory,
  createNode,
  createProject,
  getComponent,
  insertNode,
  propAsset,
  setPageTree,
  unsafeId,
  updatePageBy,
  type Asset,
  type AssetId,
  type Project,
} from '@vpb/core';
import { createEditorStore } from '@vpb/state';
import type { StorageResult } from '@vpb/storage';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Canvas } from '../Canvas.tsx';
import { createAssetResolver, managedAssetSrc, type AssetResolver } from '../assetResolver.ts';

/**
 * Phase F3, Slice F — the read path, end to end, in the canvas.
 *
 * This is the milestone's demonstration: an image node assigned a MANAGED asset
 * (its src the opaque `asset:<id>`) paints in the frame ONLY once the resolver is
 * wired. The first test is the deliberate control — without a resolver the model
 * alone yields no `src`, proving the integration (not something else) is what makes
 * the image appear.
 */

const HERO = unsafeId<AssetId>('hero');

/** A managed image asset: its persisted src is the opaque `asset:<id>` key. */
const heroAsset: Asset = {
  id: HERO,
  name: 'hero.png',
  mimeType: 'image/png',
  byteSize: 4,
  src: managedAssetSrc(HERO),
  width: 800,
  height: 600,
  createdAt: '2026-07-24T00:00:00.000Z',
};

/** A one-page project: body > img, the img assigned the managed asset. */
function projectWithImage(): Project {
  const ids = createIdFactory();
  const registry = createBuiltinRegistry();
  const imageDef = getComponent(registry, IMAGE_COMPONENT_ID);
  if (!imageDef) throw new Error('builtin registry is missing the image component');

  let project = createProject('Assets', ids);
  const home = project.pages[0];
  if (!home) throw new Error('createProject always seeds a page');

  const image = createNode(imageDef, ids, { props: { src: propAsset(HERO) } });
  const tree = insertNode(home.tree, image, home.tree.root);
  project = updatePageBy(project, home.id, (page) => setPageTree(page, tree));

  // The managed asset lives in the library; its bytes live in the (fake) adapter.
  return { ...project, assets: createAssetLibrary([heroAsset]) };
}

function mount(store: ReturnType<typeof createEditorStore>, resolver: AssetResolver | null) {
  const result = render(<Canvas store={store} resolver={resolver} />);
  const frame = result.container.querySelector('iframe');
  if (!frame) throw new Error('the canvas rendered no iframe');
  return { ...result, doc: frame.contentDocument };
}

function makeStore(project: Project) {
  return createEditorStore({ project, env: { registry: createBuiltinRegistry() } });
}

describe('the canvas paints a managed asset through the resolver', () => {
  it('renders NO src for a managed asset when no resolver is wired', () => {
    const { doc } = mount(makeStore(projectWithImage()), null);

    const img = doc?.querySelector('img');
    expect(img).not.toBeNull();
    // The opaque `asset:<id>` is not a loadable URL, so the renderer omits `src`.
    expect(img?.hasAttribute('src')).toBe(false);
  });

  it('resolves the managed asset to a blob URL and paints it', async () => {
    const resolver = createAssetResolver({
      loadBytes: async (): Promise<StorageResult<Blob>> => ({
        ok: true,
        value: new Blob(['png-bytes']),
      }),
      createObjectURL: () => 'blob:mock/hero',
      revokeObjectURL: () => {},
    });

    const { doc } = mount(makeStore(projectWithImage()), resolver);

    await waitFor(() => {
      expect(doc?.querySelector('img')?.getAttribute('src')).toBe('blob:mock/hero');
    });

    // The intrinsic size still comes from the asset record, unchanged by resolution.
    const img = doc?.querySelector('img');
    expect(img?.getAttribute('width')).toBe('800');
    expect(img?.getAttribute('height')).toBe('600');

    resolver.dispose();
  });
});
