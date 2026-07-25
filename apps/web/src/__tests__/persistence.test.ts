import {
  BOX_COMPONENT_ID,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createNode,
  createProject,
  getComponent,
} from '@vpb/core';
import { activePage, createEditorStore, insertNodeCommand } from '@vpb/state';
import { createMemoryStorageAdapter, type StorageAdapter } from '@vpb/storage';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { attachAutosave, createBrowserStorage } from '../persistence.ts';

const registry = createBuiltinRegistry();

function makeStore() {
  const ids = createDeterministicIdFactory();
  return createEditorStore({ project: createProject('Test', ids), env: { registry } });
}

describe('createBrowserStorage', () => {
  it('returns null when IndexedDB is unavailable', () => {
    expect(createBrowserStorage(undefined)).toBeNull();
  });

  it('returns a working adapter when given an IDBFactory', async () => {
    const adapter = createBrowserStorage(new IDBFactory());
    expect(adapter).not.toBeNull();
    // A round-trip proves it is a real adapter, not a placeholder.
    const list = await adapter?.listDocuments();
    expect(list?.ok).toBe(true);
  });
});

describe('attachAutosave', () => {
  it('does not attach a controller when there is no adapter', () => {
    expect(attachAutosave(makeStore(), null)).toBeNull();
  });

  it('attaches a disposable controller when an adapter exists', () => {
    const controller = attachAutosave(makeStore(), createBrowserStorage(new IDBFactory()));
    expect(controller).not.toBeNull();
    expect(() => controller?.dispose()).not.toThrow();
  });

  it('the attached controller unsubscribes on dispose (cleanup / HMR safety)', () => {
    // The mechanism the App's `import.meta.hot.dispose` relies on: disposing the
    // controller must cancel the armed timer AND stop reacting to store changes.
    let saves = 0;
    const adapter: StorageAdapter = {
      ...createMemoryStorageAdapter(),
      saveDocument: async (file) => {
        saves += 1;
        return createMemoryStorageAdapter().saveDocument(file);
      },
    };
    const timers = new Map<number, () => void>();
    let nextId = 0;

    const ids = createDeterministicIdFactory();
    const store = createEditorStore({
      project: createProject('Test', ids),
      env: { registry },
      storage: adapter,
    });
    const controller = attachAutosave(store, adapter, {
      setTimer: (callback) => {
        const id = ++nextId;
        timers.set(id, callback);
        return id;
      },
      clearTimer: (id) => {
        timers.delete(id as number);
      },
    });

    const definition = getComponent(registry, BOX_COMPONENT_ID);
    if (!definition) throw new Error('registry is missing vpb:box');
    const root = activePage(store.getState().present).tree.root;
    const editOnce = () =>
      store.getState().execute(insertNodeCommand(createNode(definition, ids), root));

    editOnce();
    expect(timers.size).toBe(1); // an edit armed one debounce timer

    controller?.dispose();
    expect(timers.size).toBe(0); // dispose cleared the armed timer

    editOnce();
    expect(timers.size).toBe(0); // unsubscribed: a later edit re-arms nothing
    expect(saves).toBe(0);
  });
});
