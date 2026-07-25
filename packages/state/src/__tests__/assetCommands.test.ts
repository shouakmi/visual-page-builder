import {
  BOX_COMPONENT_ID,
  createAssetLibrary,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createNode,
  createProject,
  getAsset,
  getComponent,
  getNode,
  getProp,
  insertNode,
  propAsset,
  setAssets,
  setPageTree,
  unsafeId,
  updatePageBy,
  type Asset,
  type AssetId,
  type NodeId,
} from '@vpb/core';
import { describe, expect, it } from 'vitest';

import { applyCommand, type Command, type EditorEnvironment } from '../command.ts';
import {
  addAssetCommand,
  removeAssetCommand,
  renameAssetCommand,
} from '../commands/assetCommands.ts';
import { activePage, createEditorState, type EditorState } from '../editorState.ts';
import { createEditorStore } from '../store.ts';

const registry = createBuiltinRegistry();
const env: EditorEnvironment = { registry };

const A = (id: string): AssetId => unsafeId<AssetId>(id);

function makeAsset(id: string, name: string): Asset {
  return {
    id: A(id),
    name,
    mimeType: 'image/png',
    byteSize: 10,
    src: `asset:${id}`,
    createdAt: '2026-07-24T00:00:00.000Z',
  };
}

function stateWith(assets: readonly Asset[]): EditorState {
  const ids = createDeterministicIdFactory();
  return createEditorState(setAssets(createProject('Test', ids), createAssetLibrary(assets)));
}

/** A state whose one node references `asset` through its `src` prop. */
function stateReferencing(asset: Asset): { state: EditorState; nodeId: NodeId } {
  const ids = createDeterministicIdFactory();
  let project = createProject('Test', ids);
  const page = project.pages[0];
  if (!page) throw new Error('createProject must seed a page');
  const definition = getComponent(registry, BOX_COMPONENT_ID);
  if (!definition) throw new Error('registry is missing vpb:box');

  const node = createNode(definition, ids, { props: { src: propAsset(asset.id) } });
  project = updatePageBy(project, page.id, (p) =>
    setPageTree(p, insertNode(page.tree, node, page.tree.root)),
  );
  project = setAssets(project, createAssetLibrary([asset]));
  return { state: createEditorState(project), nodeId: node.id };
}

function run(state: EditorState, command: Command): { state: EditorState; inverse: Command } {
  const outcome = applyCommand(state, command, env);
  if (!outcome.ok) throw new Error(`expected success, got refusal: ${outcome.reason}`);
  return { state: outcome.state, inverse: outcome.inverse };
}

function refusalOf(state: EditorState, command: Command): string {
  const outcome = applyCommand(state, command, env);
  if (outcome.ok) throw new Error('expected a refusal, got success');
  return outcome.reason;
}

/**
 * Undo restores the exact prior library, and redo (re-running the ORIGINAL
 * command) reproduces the applied library — the symmetry every command owes, and
 * the deterministic-replay guarantee the injected id makes possible.
 */
function expectSymmetric(state: EditorState, command: Command): EditorState {
  const { state: applied, inverse } = run(state, command);

  const undone = applyCommand(applied, inverse, env);
  expect(undone.ok).toBe(true);
  if (!undone.ok) return applied;
  expect(undone.state.project.assets).toEqual(state.project.assets);

  const redone = applyCommand(undone.state, command, env);
  expect(redone.ok).toBe(true);
  if (redone.ok) expect(redone.state.project.assets).toEqual(applied.project.assets);

  return applied;
}

describe('addAssetCommand', () => {
  it('adds the record, and is undo/redo symmetric', () => {
    const asset = makeAsset('a', 'a.png');
    const applied = expectSymmetric(stateWith([]), addAssetCommand(asset));
    expect(getAsset(applied.project.assets, A('a'))).toEqual(asset);
  });

  it('refuses a duplicate id rather than overwriting', () => {
    const state = stateWith([makeAsset('a', 'a.png')]);
    expect(refusalOf(state, addAssetCommand(makeAsset('a', 'other.png')))).toMatch(
      /already exists/,
    );
  });
});

describe('removeAssetCommand', () => {
  it('removes the record, and is undo/redo symmetric', () => {
    const applied = expectSymmetric(
      stateWith([makeAsset('a', 'a.png')]),
      removeAssetCommand(A('a')),
    );
    expect(getAsset(applied.project.assets, A('a'))).toBeUndefined();
  });

  it('removes an asset that is still referenced, leaving the reference dangling', () => {
    const asset = makeAsset('hero', 'hero.png');
    const { state, nodeId } = stateReferencing(asset);

    const { state: removed, inverse } = run(state, removeAssetCommand(A('hero')));
    expect(getAsset(removed.project.assets, A('hero'))).toBeUndefined();

    // The node's reference is untouched — it dangles, and the renderer degrades
    // to no `src`. removeAsset never rewrites references.
    const node = getNode(activePage(removed).tree, nodeId);
    expect(node && getProp(node.props, 'src')).toEqual(propAsset(A('hero')));

    // Undo restores the exact record; the reference resolves again.
    const restored = applyCommand(removed, inverse, env);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(getAsset(restored.state.project.assets, A('hero'))).toEqual(asset);
  });

  it('refuses when the asset does not exist', () => {
    expect(refusalOf(stateWith([]), removeAssetCommand(A('ghost')))).toMatch(/No asset/);
  });
});

describe('renameAssetCommand', () => {
  it('renames, and is undo/redo symmetric', () => {
    const applied = expectSymmetric(
      stateWith([makeAsset('a', 'old.png')]),
      renameAssetCommand(A('a'), 'new.png'),
    );
    expect(getAsset(applied.project.assets, A('a'))?.name).toBe('new.png');
  });

  it('refuses a no-op rename', () => {
    const state = stateWith([makeAsset('a', 'same.png')]);
    expect(refusalOf(state, renameAssetCommand(A('a'), 'same.png'))).toMatch(/unchanged/);
  });

  it('refuses when the asset does not exist', () => {
    expect(refusalOf(stateWith([]), renameAssetCommand(A('ghost'), 'x.png'))).toMatch(/No asset/);
  });

  it('coalesces consecutive renames of the SAME asset into one history entry', () => {
    const ids = createDeterministicIdFactory();
    let clock = 0;
    const project = setAssets(
      createProject('Test', ids),
      createAssetLibrary([makeAsset('a', 'a0.png')]),
    );
    const store = createEditorStore({ project, env, now: () => clock });

    store.getState().execute(renameAssetCommand(A('a'), 'a1.png'));
    clock += 10;
    store.getState().execute(renameAssetCommand(A('a'), 'a2.png'));

    expect(store.getState().history.past).toHaveLength(1);
    expect(getAsset(store.getState().present.project.assets, A('a'))?.name).toBe('a2.png');
  });

  it('does NOT coalesce renames of different assets', () => {
    const ids = createDeterministicIdFactory();
    const project = setAssets(
      createProject('Test', ids),
      createAssetLibrary([makeAsset('a', 'a.png'), makeAsset('b', 'b.png')]),
    );
    const store = createEditorStore({ project, env, now: () => 0 });

    store.getState().execute(renameAssetCommand(A('a'), 'a2.png'));
    store.getState().execute(renameAssetCommand(A('b'), 'b2.png'));

    expect(store.getState().history.past).toHaveLength(2);
  });
});

describe('asset command purity', () => {
  it('touches no storage, resolver, DOM, or IO, and replays deterministically from the id', () => {
    // The state project runs in node: a command reaching for a browser or storage
    // global would fail here. The environment carries only the registry.
    expect(typeof globalThis.window).toBe('undefined');
    expect(typeof globalThis.indexedDB).toBe('undefined');

    const asset = makeAsset('fixed', 'fixed.png');
    const state = stateWith([]);

    const once = applyCommand(state, addAssetCommand(asset), env);
    const twice = applyCommand(state, addAssetCommand(asset), env);
    expect(once.ok && twice.ok).toBe(true);
    if (once.ok && twice.ok) {
      // Deterministic from the injected AssetId: identical results.
      expect(once.state.project.assets).toEqual(twice.state.project.assets);
      expect(getAsset(once.state.project.assets, A('fixed'))).toEqual(asset);
    }
    // Pure: the input state was not mutated in place.
    expect(state.project.assets.assets.size).toBe(0);
  });
});
