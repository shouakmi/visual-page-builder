import {
  addAssetCommand,
  createEditorStore,
  removeAssetCommand,
  renameAssetCommand,
  type EditorEnvironment,
} from '@vpb/state';
import {
  BOX_COMPONENT_ID,
  createAssetLibrary,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createNode,
  createProject,
  getAsset,
  getComponent,
  insertNode,
  propAsset,
  setAssets,
  setPageTree,
  unsafeId,
  updatePageBy,
  type Asset,
  type AssetId,
  type Project,
} from '@vpb/core';
import { createMemoryStorageAdapter, type StorageAdapter } from '@vpb/storage';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AssetPanel } from '../AssetPanel.tsx';

const registry = createBuiltinRegistry();
const env: EditorEnvironment = { registry };
const A = (id: string): AssetId => unsafeId<AssetId>(id);
const okDecode = async () => ({ width: 4, height: 2 });

const asset = (id: string, name: string, createdAt = '2026-07-24T00:00:00.000Z'): Asset => ({
  id: A(id),
  name,
  mimeType: 'image/png',
  byteSize: 10,
  src: `asset:${id}`,
  createdAt,
});

/** A memory adapter whose `listAssetIds` reports exactly `ids` (missing-bytes control). */
function adapterWithStoredIds(ids: readonly AssetId[]): StorageAdapter {
  return {
    ...createMemoryStorageAdapter(),
    async listAssetIds() {
      return { ok: true, value: [...ids] };
    },
  };
}

function storeWith(
  assets: readonly Asset[],
  build?: (project: Project, ids: ReturnType<typeof createDeterministicIdFactory>) => Project,
) {
  const ids = createDeterministicIdFactory();
  let project = createProject('Test', ids);
  if (build) project = build(project, ids); // reuse `ids` so node ids don't collide with the root
  project = setAssets(project, createAssetLibrary(assets));
  return createEditorStore({ project, env, now: () => 0 });
}

function renderPanel(store: ReturnType<typeof storeWith>, adapter: StorageAdapter) {
  return render(
    <AssetPanel
      store={store}
      adapter={adapter}
      ids={createDeterministicIdFactory()}
      decode={okDecode}
    />,
  );
}

describe('AssetPanel', () => {
  it('lists assets newest first', async () => {
    const store = storeWith([
      asset('old', 'old.png', '2026-01-01T00:00:00.000Z'),
      asset('new', 'new.png', '2026-12-01T00:00:00.000Z'),
    ]);
    renderPanel(store, adapterWithStoredIds([A('old'), A('new')]));

    await screen.findByTitle('new.png');
    const names = screen.getAllByTitle(/\.png$/).map((el) => el.textContent);
    expect(names).toEqual(['new.png', 'old.png']);
  });

  it('flags an asset whose bytes are missing', async () => {
    const store = storeWith([asset('present', 'p.png'), asset('gone', 'g.png')]);
    renderPanel(store, adapterWithStoredIds([A('present')])); // only 'present' has bytes

    await screen.findByText('missing');
    const goneItem = screen.getByTitle('g.png').closest('li');
    const presentItem = screen.getByTitle('p.png').closest('li');
    expect(goneItem && within(goneItem).getByText('missing')).toBeInTheDocument();
    expect(presentItem && within(presentItem).queryByText('missing')).toBeNull();
  });

  it('shows an unused badge for an asset nothing references', async () => {
    const store = storeWith([asset('lonely', 'lonely.png')]);
    renderPanel(store, adapterWithStoredIds([A('lonely')]));

    await screen.findByText('unused');
  });

  it('renames an asset through the inline editor', async () => {
    const store = storeWith([asset('a', 'a.png')]);
    renderPanel(store, adapterWithStoredIds([A('a')]));

    fireEvent.click(await screen.findByRole('button', { name: 'Rename a.png' }));
    const input = screen.getByRole('textbox', { name: 'Rename a.png' });
    fireEvent.change(input, { target: { value: 'renamed.png' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(getAsset(store.getState().present.project.assets, A('a'))?.name).toBe('renamed.png'),
    );
  });

  it('deletes an asset only after confirmation', async () => {
    const store = storeWith([asset('a', 'a.png')]);
    renderPanel(store, adapterWithStoredIds([A('a')]));

    fireEvent.click(await screen.findByRole('button', { name: 'Delete a.png' }));
    // Not gone yet — the confirm dialog is showing.
    expect(getAsset(store.getState().present.project.assets, A('a'))).toBeDefined();
    expect(screen.getByRole('alertdialog', { name: 'Delete a.png?' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete a.png' }));
    await waitFor(() =>
      expect(getAsset(store.getState().present.project.assets, A('a'))).toBeUndefined(),
    );
  });

  it('cancels a delete without removing the asset', async () => {
    const store = storeWith([asset('a', 'a.png')]);
    renderPanel(store, adapterWithStoredIds([A('a')]));

    fireEvent.click(await screen.findByRole('button', { name: 'Delete a.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel delete a.png' }));

    expect(getAsset(store.getState().present.project.assets, A('a'))).toBeDefined();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('warns when deleting an asset that is still in use', async () => {
    const store = storeWith([asset('used', 'u.png')], (project, ids) => {
      const page = project.pages[0];
      if (!page) throw new Error('no page');
      const definition = getComponent(registry, BOX_COMPONENT_ID);
      if (!definition) throw new Error('no vpb:box');
      const node = createNode(definition, ids, {
        props: { src: propAsset(A('used')) },
      });
      return updatePageBy(project, page.id, (p) =>
        setPageTree(p, insertNode(p.tree, node, p.tree.root)),
      );
    });
    renderPanel(store, adapterWithStoredIds([A('used')]));

    fireEvent.click(await screen.findByRole('button', { name: 'Delete u.png' }));
    expect(screen.getByText(/still in use/i)).toBeInTheDocument();
  });

  it('uploads a valid image and shows it in the list', async () => {
    const store = storeWith([]);
    const adapter = createMemoryStorageAdapter();
    render(
      <AssetPanel
        store={store}
        adapter={adapter}
        ids={createDeterministicIdFactory()}
        decode={okDecode}
      />,
    );

    const input = screen.getByLabelText('Upload image');
    const file = new File([new Uint8Array(8)], 'hero.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await screen.findByTitle('hero.png');
    expect(store.getState().present.project.assets.assets.size).toBe(1);
  });

  it('shows an error and adds nothing when an invalid file is uploaded', async () => {
    const store = storeWith([]);
    const adapter = createMemoryStorageAdapter();
    render(
      <AssetPanel
        store={store}
        adapter={adapter}
        ids={createDeterministicIdFactory()}
        decode={async () => null} // undecodable
      />,
    );

    const input = screen.getByLabelText('Upload image');
    const file = new File([new Uint8Array(8)], 'bad.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await screen.findByRole('alert');
    expect(store.getState().present.project.assets.assets.size).toBe(0);
  });

  it('stays in sync with the store after rapid consecutive operations', async () => {
    const store = storeWith([asset('a', 'a.png'), asset('b', 'b.png')]);
    renderPanel(store, adapterWithStoredIds([A('a'), A('b')]));
    await screen.findByTitle('a.png');

    act(() => {
      store.getState().execute(renameAssetCommand(A('a'), 'a2.png'));
      store.getState().execute(removeAssetCommand(A('b')));
      store.getState().execute(addAssetCommand(asset('c', 'c.png', '2026-12-31T00:00:00.000Z')));
    });

    await waitFor(() => {
      expect(screen.queryByTitle('b.png')).toBeNull();
      expect(screen.getByTitle('a2.png')).toBeInTheDocument();
      expect(screen.getByTitle('c.png')).toBeInTheDocument();
    });
    const shown = screen.getAllByTitle(/\.png$/).map((el) => el.textContent);
    expect([...shown].toSorted()).toEqual(['a2.png', 'c.png']);
  });
});
