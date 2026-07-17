import {
  BASE_BREAKPOINT_ID,
  BOX_COMPONENT_ID,
  MOBILE_BREAKPOINT_ID,
  childIdsOf,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createNode,
  createProject,
  findRule,
  getComponent,
  nodeScope,
  px,
  target,
  unsafeId,
  type IdFactory,
  type Node,
  type StyleRuleId,
} from '@vpb/core';
import { describe, expect, it } from 'vitest';

import { insertNodeCommand, removeNodeCommand } from '../commands/nodeCommands.ts';
import { setStylePropertyCommand } from '../commands/styleCommands.ts';
import { activePage } from '../editorState.ts';
import { createHistory } from '../history.ts';
import { createEditorStore, type EditorStoreOptions } from '../store.ts';

const registry = createBuiltinRegistry();
const base = target(BASE_BREAKPOINT_ID);
const ruleId = (v: string) => unsafeId<StyleRuleId>(v);

function boxNode(ids: IdFactory): Node {
  const definition = getComponent(registry, BOX_COMPONENT_ID);
  if (!definition) throw new Error('registry is missing vpb:box');
  return createNode(definition, ids);
}

function makeStore(overrides: Partial<EditorStoreOptions> = {}) {
  const ids = createDeterministicIdFactory();
  const project = createProject('Test', ids);
  let clock = 0;
  const store = createEditorStore({
    project,
    env: { registry },
    now: () => clock,
    ...overrides,
  });
  return { store, ids, tick: (ms: number) => (clock += ms) };
}

const rootOf = (store: ReturnType<typeof makeStore>['store']) =>
  activePage(store.getState().present).tree.root;
const childrenOf = (store: ReturnType<typeof makeStore>['store']) =>
  childIdsOf(activePage(store.getState().present).tree, rootOf(store));

describe('execute', () => {
  it('applies a command and records one entry', () => {
    const { store, ids } = makeStore();
    const box = boxNode(ids);

    const outcome = store.getState().execute(insertNodeCommand(box, rootOf(store)));

    expect(outcome.ok).toBe(true);
    expect(childrenOf(store)).toEqual([box.id]);
    expect(store.getState().history.past).toHaveLength(1);
    expect(store.getState().canUndo()).toBe(true);
  });

  it('returns a refusal and records nothing', () => {
    const { store } = makeStore();
    const outcome = store.getState().execute(removeNodeCommand(rootOf(store)));

    expect(outcome.ok).toBe(false);
    expect(store.getState().history.past).toEqual([]);
  });

  it('keeps present and committed in step', () => {
    const { store, ids } = makeStore();
    store.getState().execute(insertNodeCommand(boxNode(ids), rootOf(store)));

    expect(store.getState().present).toBe(store.getState().committed);
  });

  it('notifies subscribers', () => {
    // The store is the thing Phase D will bind React to; if it does not notify,
    // nothing repaints.
    const { store, ids } = makeStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => notifications++);

    store.getState().execute(insertNodeCommand(boxNode(ids), rootOf(store)));
    expect(notifications).toBeGreaterThan(0);

    unsubscribe();
    store.getState().execute(insertNodeCommand(boxNode(ids), rootOf(store)));
    expect(notifications).toBe(1);
  });
});

describe('undo / redo through the store', () => {
  it('undoes and redoes', () => {
    const { store, ids } = makeStore();
    const box = boxNode(ids);
    store.getState().execute(insertNodeCommand(box, rootOf(store)));

    expect(store.getState().undo()).toBe(true);
    expect(childrenOf(store)).toEqual([]);
    expect(store.getState().canRedo()).toBe(true);

    expect(store.getState().redo()).toBe(true);
    expect(childrenOf(store)).toEqual([box.id]);
  });

  it('reports false when there is nothing to do', () => {
    const { store } = makeStore();
    expect(store.getState().undo()).toBe(false);
    expect(store.getState().redo()).toBe(false);
  });
});

/**
 * TRANSIENT VS COMMITTED — AUDIT §4.3's fourth requirement.
 *
 * A drag emits a value per frame. Without this separation each frame is an edit,
 * and the user's undo rewinds their drag one pixel at a time. Coalescing would
 * merge them, but only within a time window; a slow drag would still split. The
 * preview/commit pair is the exact answer: nothing reaches history until the
 * gesture ends.
 */
describe('preview / commitPreview', () => {
  it('shows the effect without recording it', () => {
    const { store, ids } = makeStore();
    const box = boxNode(ids);
    store.getState().execute(insertNodeCommand(box, rootOf(store)));
    const entriesBefore = store.getState().history.past.length;

    store
      .getState()
      .preview(setStylePropertyCommand(nodeScope(box.id), base, 'width', px(50), ruleId('r1')));

    expect(
      findRule(store.getState().present.project.styles, nodeScope(box.id), base)?.declarations
        .width,
    ).toEqual(px(50));
    expect(store.getState().history.past).toHaveLength(entriesBefore);
    expect(store.getState().present).not.toBe(store.getState().committed);
  });

  it('applies every preview to `committed`, so a drag does not stack', () => {
    const { store, ids } = makeStore();
    const box = boxNode(ids);
    store.getState().execute(insertNodeCommand(box, rootOf(store)));

    for (const width of [10, 20, 30, 40, 50]) {
      store
        .getState()
        .preview(
          setStylePropertyCommand(nodeScope(box.id), base, 'width', px(width), ruleId('r1')),
        );
    }

    expect(
      findRule(store.getState().present.project.styles, nodeScope(box.id), base)?.declarations
        .width,
    ).toEqual(px(50));
    expect(store.getState().history.past).toHaveLength(1);
  });

  /**
   * The test above cannot actually tell where a preview is applied.
   *
   * `setStyleProperty` ASSIGNS, so re-applying it to the previous preview lands
   * on the same width as applying it to `committed` — the assertion passes
   * either way. This one uses an edit that is not idempotent: the same insert,
   * previewed twice. Against `committed` both succeed and the node appears once;
   * against the previous preview the second is refused, because the node it is
   * inserting is already there.
   */
  it('re-previewing the same insert succeeds and inserts once', () => {
    const { store, ids } = makeStore();
    const box = boxNode(ids);

    const first = store.getState().preview(insertNodeCommand(box, rootOf(store)));
    const second = store.getState().preview(insertNodeCommand(box, rootOf(store)));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(childrenOf(store)).toEqual([box.id]);
  });

  it('a new preview supersedes the previous one rather than stacking on it', () => {
    // `pending` holds ONE command. Previewing a different edit discards the
    // first, which is why each preview starts from `committed`.
    const { store, ids } = makeStore();
    const box = boxNode(ids);
    store.getState().execute(insertNodeCommand(box, rootOf(store)));

    store
      .getState()
      .preview(setStylePropertyCommand(nodeScope(box.id), base, 'width', px(50), ruleId('r1')));
    store
      .getState()
      .preview(setStylePropertyCommand(nodeScope(box.id), base, 'height', px(80), ruleId('r1')));

    const rule = findRule(store.getState().present.project.styles, nodeScope(box.id), base);
    expect(rule?.declarations.height).toEqual(px(80));
    expect(rule?.declarations.width).toBeUndefined();
  });

  it('records exactly ONE entry for a whole drag', () => {
    const { store, ids } = makeStore();
    const box = boxNode(ids);
    store.getState().execute(insertNodeCommand(box, rootOf(store)));

    for (const width of [10, 20, 30, 40, 50]) {
      store
        .getState()
        .preview(
          setStylePropertyCommand(nodeScope(box.id), base, 'width', px(width), ruleId('r1')),
        );
    }
    store.getState().commitPreview();

    expect(store.getState().history.past).toHaveLength(2);
    expect(store.getState().present).toBe(store.getState().committed);
    expect(store.getState().pending).toBeNull();
  });

  it('undoes a committed drag back to before it started, in one step', () => {
    const { store, ids } = makeStore();
    const box = boxNode(ids);
    store.getState().execute(insertNodeCommand(box, rootOf(store)));

    for (const width of [10, 30, 50]) {
      store
        .getState()
        .preview(
          setStylePropertyCommand(nodeScope(box.id), base, 'width', px(width), ruleId('r1')),
        );
    }
    store.getState().commitPreview();
    store.getState().undo();

    expect(
      findRule(store.getState().present.project.styles, nodeScope(box.id), base),
    ).toBeUndefined();
  });

  it('cancelPreview restores the committed state — Escape mid-drag', () => {
    const { store, ids } = makeStore();
    const box = boxNode(ids);
    store.getState().execute(insertNodeCommand(box, rootOf(store)));
    const committed = store.getState().committed;

    store
      .getState()
      .preview(setStylePropertyCommand(nodeScope(box.id), base, 'width', px(50), ruleId('r1')));
    store.getState().cancelPreview();

    expect(store.getState().present).toBe(committed);
    expect(store.getState().pending).toBeNull();
    expect(store.getState().history.past).toHaveLength(1);
  });

  it('commitPreview with nothing pending does nothing', () => {
    const { store } = makeStore();
    expect(store.getState().commitPreview()).toBeUndefined();
    expect(store.getState().history.past).toEqual([]);
  });

  it('a refused preview leaves the present alone', () => {
    const { store } = makeStore();
    const present = store.getState().present;

    const outcome = store.getState().preview(removeNodeCommand(rootOf(store)));
    expect(outcome.ok).toBe(false);
    expect(store.getState().present).toBe(present);
    expect(store.getState().pending).toBeNull();
  });

  it('undo drops a pending preview rather than rewinding through it', () => {
    const { store, ids } = makeStore();
    const box = boxNode(ids);
    store.getState().execute(insertNodeCommand(box, rootOf(store)));

    store
      .getState()
      .preview(setStylePropertyCommand(nodeScope(box.id), base, 'width', px(50), ruleId('r1')));
    store.getState().undo();

    expect(store.getState().pending).toBeNull();
    expect(childrenOf(store)).toEqual([]);
  });
});

describe('context actions', () => {
  it('select does not touch history', () => {
    // AUDIT 4.3: `select = (id) => commit({...state, selectedId: id})` meant
    // undo undid clicks.
    const { store, ids } = makeStore();
    const box = boxNode(ids);
    store.getState().execute(insertNodeCommand(box, rootOf(store)));
    const entries = store.getState().history.past.length;

    store.getState().select([box.id]);
    store.getState().clearSelection();
    store.getState().extendSelection([box.id]);

    expect(store.getState().history.past).toHaveLength(entries);
    expect(store.getState().present.context.selection).toEqual([box.id]);
  });

  it('breakpoint switches do not touch history', () => {
    const { store } = makeStore();
    store.getState().setActiveBreakpoint(MOBILE_BREAKPOINT_ID);

    expect(store.getState().history.past).toEqual([]);
    expect(store.getState().present.context.activeBreakpointId).toBe(MOBILE_BREAKPOINT_ID);
  });

  it('a selection made during a preview survives the commit', () => {
    const { store, ids } = makeStore();
    const box = boxNode(ids);
    store.getState().execute(insertNodeCommand(box, rootOf(store)));

    store
      .getState()
      .preview(setStylePropertyCommand(nodeScope(box.id), base, 'width', px(50), ruleId('r1')));
    store.getState().select([box.id]);
    store.getState().commitPreview();

    expect(store.getState().present.context.selection).toEqual([box.id]);
  });
});

describe('coalescing through the store', () => {
  it('merges rapid executes on one property', () => {
    const { store, ids, tick } = makeStore();
    const box = boxNode(ids);
    store.getState().execute(insertNodeCommand(box, rootOf(store)));

    for (const width of [10, 20, 30]) {
      tick(10);
      store
        .getState()
        .execute(
          setStylePropertyCommand(nodeScope(box.id), base, 'width', px(width), ruleId('r1')),
        );
    }

    expect(store.getState().history.past).toHaveLength(2);
  });

  it('splits when the user pauses past the window', () => {
    const { store, ids, tick } = makeStore();
    const box = boxNode(ids);
    store.getState().execute(insertNodeCommand(box, rootOf(store)));

    store
      .getState()
      .execute(setStylePropertyCommand(nodeScope(box.id), base, 'width', px(10), ruleId('r1')));
    tick(5000);
    store
      .getState()
      .execute(setStylePropertyCommand(nodeScope(box.id), base, 'width', px(20), ruleId('r1')));

    expect(store.getState().history.past).toHaveLength(3);
  });

  it('honours an injected history configuration', () => {
    const { store, ids } = makeStore({ history: createHistory({ limit: 2 }) });
    for (let i = 0; i < 4; i++) {
      store.getState().execute(insertNodeCommand(boxNode(ids), rootOf(store)));
    }
    expect(store.getState().history.past).toHaveLength(2);
  });
});

describe('headlessness', () => {
  it('runs with no DOM at all', () => {
    // The state project runs in node, so this passes by existing -- but it says
    // out loud what the package promises. AUDIT 7.8: the prototype's state was a
    // React hook, testable in no host but a browser.
    expect(typeof globalThis.document).toBe('undefined');
    expect(typeof globalThis.window).toBe('undefined');

    const { store, ids } = makeStore();
    const box = boxNode(ids);
    store.getState().execute(insertNodeCommand(box, rootOf(store)));
    expect(childrenOf(store)).toEqual([box.id]);
  });
});
