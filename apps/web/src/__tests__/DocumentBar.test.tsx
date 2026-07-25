import {
  BOX_COMPONENT_ID,
  createBuiltinRegistry,
  createIdFactory,
  createNode,
  createProject,
  getComponent,
  unsafeId,
  type IdFactory,
  type Node,
  type ProjectId,
} from '@vpb/core';
import { activePage, createEditorStore, insertNodeCommand } from '@vpb/state';
import {
  createMemoryStorageAdapter,
  storageErr,
  storageOk,
  type StorageAdapter,
} from '@vpb/storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DocumentBar } from '../DocumentBar.tsx';

const registry = createBuiltinRegistry();

function boxNode(ids: IdFactory): Node {
  const definition = getComponent(registry, BOX_COMPONENT_ID);
  if (!definition) throw new Error('registry is missing vpb:box');
  return createNode(definition, ids);
}

/** The memory adapter with specific methods swapped for failing/controlled ones. */
function stubAdapter(overrides: Partial<StorageAdapter>): StorageAdapter {
  return { ...createMemoryStorageAdapter(), ...overrides };
}

// Random ids so two stores sharing an adapter get distinct project ids — a
// deterministic factory would mint the same 'project-1' for both and make the
// "loaded the saved id" assertion vacuous.
function makeStore(adapter: StorageAdapter, name: string) {
  const ids = createIdFactory();
  const store = createEditorStore({
    project: createProject(name, ids),
    env: { registry },
    storage: adapter,
  });
  const edit = () => {
    const root = activePage(store.getState().present).tree.root;
    store.getState().execute(insertNodeCommand(boxNode(ids), root));
  };
  return { store, edit };
}

describe('DocumentBar', () => {
  it('New starts a fresh, never-saved document', () => {
    const adapter = createMemoryStorageAdapter();
    const { store } = makeStore(adapter, 'Original');
    render(<DocumentBar store={store} adapter={adapter} ids={createIdFactory()} />);

    fireEvent.click(screen.getByRole('button', { name: 'New' }));

    expect(store.getState().present.project.name).toBe('Untitled');
    expect(store.getState().history.past).toEqual([]);
    expect(store.getState().isDirty()).toBe(true);
    expect(screen.getByText('Untitled')).toBeInTheDocument();
  });

  it('Save persists the document and clears the dirty indicator', async () => {
    const adapter = createMemoryStorageAdapter();
    const { store, edit } = makeStore(adapter, 'Doc');
    render(<DocumentBar store={store} adapter={adapter} ids={createIdFactory()} />);

    act(() => edit());
    expect(screen.getByText('Unsaved')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(store.getState().isDirty()).toBe(false));
    expect(screen.getByText('Saved')).toBeInTheDocument();

    const loaded = await adapter.loadDocument(store.getState().committed.project.id);
    expect(loaded.ok).toBe(true);
  });

  it('Open lists saved documents and loads one through the store', async () => {
    const adapter = createMemoryStorageAdapter();

    // Seed a saved document from a separate writer store.
    const { store: writer, edit } = makeStore(adapter, 'Saved Doc');
    act(() => edit());
    await writer.getState().save();
    const savedId = writer.getState().committed.project.id;

    const { store: reader } = makeStore(adapter, 'Reader');
    render(<DocumentBar store={reader} adapter={adapter} ids={createIdFactory()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const item = await screen.findByRole('button', { name: 'Saved Doc' });
    fireEvent.click(item);

    // Opening went through store.loadDocument: the id changed AND history was
    // reset to a fresh, clean baseline.
    await waitFor(() => expect(reader.getState().committed.project.id).toBe(savedId));
    expect(reader.getState().history.past).toEqual([]);
    expect(reader.getState().isDirty()).toBe(false);
  });

  it('reflects the store dirty state as it changes', async () => {
    const adapter = createMemoryStorageAdapter();
    const { store } = makeStore(adapter, 'Doc');
    render(<DocumentBar store={store} adapter={adapter} ids={createIdFactory()} />);

    // Fresh, never-saved: dirty.
    expect(screen.getByText('Unsaved')).toBeInTheDocument();

    await act(async () => {
      await store.getState().save();
    });
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('surfaces a save failure instead of showing success', async () => {
    const adapter = stubAdapter({
      saveDocument: async () => storageErr({ kind: 'io-error', detail: 'disk full' }),
    });
    const { store, edit } = makeStore(adapter, 'Doc');
    render(<DocumentBar store={store} adapter={adapter} ids={createIdFactory()} />);

    act(() => edit());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
    expect(store.getState().isDirty()).toBe(true);
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('shows an error when listing fails, never an empty "no documents" list', async () => {
    const adapter = stubAdapter({
      listDocuments: async () => storageErr({ kind: 'io-error', detail: 'unreadable' }),
    });
    const { store } = makeStore(adapter, 'Doc');
    render(<DocumentBar store={store} adapter={adapter} ids={createIdFactory()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not list documents');
    expect(screen.queryByText('No saved documents')).toBeNull();
  });

  it('surfaces a load failure and leaves the current document untouched', async () => {
    const brokenId = unsafeId<ProjectId>('broken');
    const adapter = stubAdapter({
      listDocuments: async () =>
        storageOk([{ id: brokenId, name: 'Broken', updatedAt: '2026-07-23T00:00:00.000Z' }]),
      loadDocument: async () => storageErr({ kind: 'corrupt', detail: 'bad bytes' }),
    });
    const { store } = makeStore(adapter, 'Current');
    render(<DocumentBar store={store} adapter={adapter} ids={createIdFactory()} />);
    const before = store.getState().present;

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Broken' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open document');
    expect(store.getState().present).toBe(before);
  });

  it('does not start a second save while one is in flight', async () => {
    let saveCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = stubAdapter({
      saveDocument: async () => {
        saveCalls += 1;
        await gate;
        return storageOk(undefined);
      },
    });
    const { store, edit } = makeStore(adapter, 'Doc');
    render(<DocumentBar store={store} adapter={adapter} ids={createIdFactory()} />);

    act(() => edit());
    const saveButton = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton); // second click while the first save is in flight

    expect(saveCalls).toBe(1);

    release();
    await waitFor(() => expect(store.getState().isDirty()).toBe(false));
  });
});
