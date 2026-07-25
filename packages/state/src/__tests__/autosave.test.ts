import {
  BOX_COMPONENT_ID,
  childIdsOf,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createNode,
  createProject,
  deserializeDocumentFile,
  getComponent,
  type IdFactory,
  type Node,
} from '@vpb/core';
import { createMemoryStorageAdapter, type StorageAdapter, type StorageResult } from '@vpb/storage';
import { describe, expect, it } from 'vitest';

import { createAutosaveController } from '../autosave.ts';
import { insertNodeCommand } from '../commands/nodeCommands.ts';
import { activePage } from '../editorState.ts';
import { createEditorStore } from '../store.ts';

const registry = createBuiltinRegistry();

function boxNode(ids: IdFactory): Node {
  const definition = getComponent(registry, BOX_COMPONENT_ID);
  if (!definition) throw new Error('registry is missing vpb:box');
  return createNode(definition, ids);
}

/**
 * A driven timer: at most one debounce timer is ever armed (schedule clears the
 * previous), so `run()` fires whatever is pending and returns each callback's
 * promise. Tests await those promises to let the async save settle — no real
 * clock, no `vi.useFakeTimers`.
 */
function makeFakeTimer() {
  let handle = 0;
  const timers = new Map<number, () => void>();
  return {
    setTimer: (callback: () => void): number => {
      const id = ++handle;
      timers.set(id, callback);
      return id;
    },
    clearTimer: (h: unknown): void => {
      timers.delete(h as number);
    },
    pending: (): number => timers.size,
    run: (): Array<void | Promise<void>> => {
      const callbacks = [...timers.values()];
      timers.clear();
      return callbacks.map((cb) => cb() as void | Promise<void>);
    },
  };
}

/**
 * Wraps the memory adapter to count saves, detect overlap, and — when armed —
 * hold each `saveDocument` open until `releaseAll()` so a test can keep a save
 * "in flight" while it makes another edit.
 */
function makeTrackingAdapter() {
  const inner = createMemoryStorageAdapter();
  let saveCount = 0;
  let inFlight = 0;
  let overlaps = 0;
  let deferred = false;
  const gates: Array<() => void> = [];

  const adapter: StorageAdapter = {
    ...inner,
    async saveDocument(file) {
      saveCount += 1;
      inFlight += 1;
      if (inFlight > 1) overlaps += 1;
      if (deferred) await new Promise<void>((resolve) => gates.push(resolve));
      const result = await inner.saveDocument(file);
      inFlight -= 1;
      return result;
    },
  };

  return {
    adapter,
    get saveCount() {
      return saveCount;
    },
    get overlaps() {
      return overlaps;
    },
    setDeferred(value: boolean) {
      deferred = value;
    },
    releaseAll() {
      gates.splice(0).forEach((resolve) => resolve());
    },
  };
}

function makeHarness(extra?: {
  storage?: StorageAdapter;
  onSettled?: (result: StorageResult<void>) => void;
}) {
  const ids = createDeterministicIdFactory();
  const project = createProject('Test', ids);
  const timer = makeFakeTimer();
  const store = createEditorStore({
    project,
    env: { registry },
    now: () => 0,
    ...(extra?.storage ? { storage: extra.storage } : {}),
  });
  const controller = createAutosaveController(store, {
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    ...(extra?.onSettled ? { onSettled: extra.onSettled } : {}),
  });
  const root = activePage(store.getState().present).tree.root;
  const edit = () => store.getState().execute(insertNodeCommand(boxNode(ids), root));
  return { store, timer, controller, ids, root, edit };
}

describe('createAutosaveController', () => {
  it('debounces a burst of edits into a single save', async () => {
    const tracking = makeTrackingAdapter();
    const { timer, edit } = makeHarness({ storage: tracking.adapter });

    edit();
    edit();
    edit();
    // The debounce reset on every change collapses the burst to one armed timer.
    expect(timer.pending()).toBe(1);

    await Promise.all(timer.run());

    expect(tracking.saveCount).toBe(1);
  });

  it('marks the document clean after an autosave', async () => {
    const { store, timer, edit } = makeHarness({ storage: createMemoryStorageAdapter() });
    edit();
    expect(store.getState().isDirty()).toBe(true);

    await Promise.all(timer.run());

    expect(store.getState().isDirty()).toBe(false);
  });

  it('does not save while a gesture is pending', async () => {
    const tracking = makeTrackingAdapter();
    const { store, timer, edit, ids, root } = makeHarness({ storage: tracking.adapter });

    edit();
    // A live preview owns the document; the armed timer must skip rather than
    // persist mid-gesture.
    store.getState().preview(insertNodeCommand(boxNode(ids), root));
    expect(store.getState().pending).not.toBeNull();

    await Promise.all(timer.run());
    expect(tracking.saveCount).toBe(0);
    expect(store.getState().isDirty()).toBe(true);

    // Cancelling the gesture re-arms the save.
    store.getState().cancelPreview();
    await Promise.all(timer.run());
    expect(tracking.saveCount).toBe(1);
  });

  it('never overlaps a save, and trails an edit made while one is in flight', async () => {
    const tracking = makeTrackingAdapter();
    tracking.setDeferred(true);
    const { timer, edit } = makeHarness({ storage: tracking.adapter });

    edit();
    const [firstSave] = timer.run(); // starts the deferred save; it stays in flight

    // An edit during the save is ignored for scheduling (no second timer armed),
    // so no concurrent save can start.
    edit();
    expect(timer.pending()).toBe(0);

    tracking.releaseAll();
    await firstSave;

    // The trailing check saw the mid-save edit and armed exactly one follow-up.
    expect(tracking.saveCount).toBe(1);
    expect(tracking.overlaps).toBe(0);
    expect(timer.pending()).toBe(1);

    tracking.setDeferred(false);
    await Promise.all(timer.run());
    expect(tracking.saveCount).toBe(2);
    expect(tracking.overlaps).toBe(0);
  });

  it('persists the mid-save edit — ignoring notifications while saving never suppresses the trailing save', async () => {
    // The guarantee demonstrated, not just reasoned about: an edit whose
    // notification is dropped (because a save was in flight) must still reach
    // storage via the trailing save, and the document must end fully clean.
    const tracking = makeTrackingAdapter();
    tracking.setDeferred(true);
    const { store, timer, edit } = makeHarness({ storage: tracking.adapter });

    edit(); // node 1
    const [firstSave] = timer.run(); // save starts against the 1-node document

    edit(); // node 2, during the save — its notification is ignored
    tracking.releaseAll();
    await firstSave;

    // `save()` captured `committed`/`history` synchronously at its call, so it
    // persisted only node 1 and anchored the checkpoint to node 1 — leaving the
    // document dirty and the trailing save armed for node 2.
    expect(timer.pending()).toBe(1);
    tracking.setDeferred(false);
    await Promise.all(timer.run());

    const id = store.getState().committed.project.id;
    const loaded = await tracking.adapter.loadDocument(id);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      const result = deserializeDocumentFile(loaded.value);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const page = result.document.project.pages[0];
        expect(page).toBeDefined();
        if (page) expect(childIdsOf(page.tree, page.tree.root)).toHaveLength(2);
      }
    }
    expect(store.getState().isDirty()).toBe(false);
  });

  it('a throwing onSettled does not reject the chain or suppress the trailing save', async () => {
    // Without the try/catch around onSettled, the throw would reject the save
    // chain (so `await firstSave` would throw) and skip the trailing schedule.
    const tracking = makeTrackingAdapter();
    tracking.setDeferred(true);
    const { timer, edit } = makeHarness({
      storage: tracking.adapter,
      onSettled: () => {
        throw new Error('host status callback blew up');
      },
    });

    edit();
    const [firstSave] = timer.run();
    edit(); // during the save
    tracking.releaseAll();
    await firstSave; // resolves despite the throw — the chain did not reject

    expect(timer.pending()).toBe(1); // trailing still armed
    tracking.setDeferred(false);
    await Promise.all(timer.run());
    expect(tracking.saveCount).toBe(2);
  });

  it('does not save a clean document when only the context changes', async () => {
    const tracking = makeTrackingAdapter();
    const { store, timer, edit } = makeHarness({ storage: tracking.adapter });

    edit();
    await Promise.all(timer.run());
    expect(tracking.saveCount).toBe(1);
    expect(store.getState().isDirty()).toBe(false);

    // A selection change notifies subscribers but leaves the document clean.
    const child = activePage(store.getState().present).tree;
    const someId = [...child.nodes.keys()][0];
    if (someId) store.getState().select([someId]);
    await Promise.all(timer.run());

    expect(tracking.saveCount).toBe(1);
  });

  it('reports each save result through onSettled', async () => {
    const results: Array<StorageResult<void>> = [];
    const { timer, edit } = makeHarness({
      storage: createMemoryStorageAdapter(),
      onSettled: (result) => results.push(result),
    });

    edit();
    await Promise.all(timer.run());

    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
  });

  it('dispose cancels an armed save and stops listening', async () => {
    const tracking = makeTrackingAdapter();
    const { timer, controller, edit } = makeHarness({ storage: tracking.adapter });

    edit();
    expect(timer.pending()).toBe(1);

    controller.dispose();
    expect(timer.pending()).toBe(0); // the armed timer was cleared

    edit(); // no longer subscribed, so nothing re-arms
    expect(timer.pending()).toBe(0);

    await Promise.all(timer.run());
    expect(tracking.saveCount).toBe(0);
  });

  it('dispose during an in-flight save prevents the trailing save', async () => {
    const tracking = makeTrackingAdapter();
    tracking.setDeferred(true);
    const { timer, controller, edit } = makeHarness({ storage: tracking.adapter });

    edit();
    const [firstSave] = timer.run(); // deferred save in flight

    edit(); // ignored while saving
    controller.dispose();

    tracking.releaseAll();
    await firstSave;

    // The in-flight save completed, but the trailing check saw `disposed` and
    // armed nothing.
    expect(tracking.saveCount).toBe(1);
    expect(timer.pending()).toBe(0);
  });
});
