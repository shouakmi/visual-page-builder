import {
  BASE_BREAKPOINT_ID,
  BOX_COMPONENT_ID,
  MOBILE_BREAKPOINT_ID,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createIdFactory,
  createNode,
  createProject,
  findRule,
  getComponent,
  insertNode,
  nodeScope,
  px,
  setPageTree,
  target,
  updatePageBy,
  type ComponentId,
  type IdFactory,
  type Node,
  type NodeId,
  type StyleTarget,
} from '@vpb/core';
import type { SnapCandidate, SnapGuide } from '@vpb/interaction';
import { createEditorStore } from '@vpb/state';
import { describe, expect, it } from 'vitest';

import { createResizeController } from '../resizeController.ts';

/**
 * The controller drives a REAL store — no DOM, because the start size is handed in
 * rather than measured. So the whole preview/commit/cancel contract is asserted
 * here: a resize previews width/height on `present`, commits ONE entry on release,
 * a cancelled or sub-threshold grab leaves the document and the undo stack
 * untouched, and the write lands on the active breakpoint.
 */

const registry = createBuiltinRegistry();
const START = { width: 100, height: 50 };

function make(ids: IdFactory, component: ComponentId): Node {
  const definition = getComponent(registry, component);
  if (!definition) throw new Error(`registry is missing ${component}`);
  return createNode(definition, ids);
}

function buildStore() {
  const ids = createDeterministicIdFactory();
  let project = createProject('Test', ids);
  const home = project.pages[0];
  if (!home) throw new Error('createProject always seeds a page');

  const box = make(ids, BOX_COMPONENT_ID);
  project = updatePageBy(project, home.id, (page) =>
    setPageTree(page, insertNode(home.tree, box, home.tree.root)),
  );

  const store = createEditorStore({ project, env: { registry } });
  return { store, box: box.id };
}

function controllerFor(store: ReturnType<typeof buildStore>['store']) {
  return createResizeController(store, { ids: createIdFactory() });
}

function sizeOf(
  store: ReturnType<typeof buildStore>['store'],
  which: 'present' | 'committed',
  box: NodeId,
  tgt: StyleTarget = target(BASE_BREAKPOINT_ID),
) {
  const state = which === 'present' ? store.getState().present : store.getState().committed;
  return findRule(state.project.styles, nodeScope(box), tgt)?.declarations;
}

describe('a completed resize', () => {
  it('previews width/height on present, then commits them to history on release', () => {
    const { store, box } = buildStore();
    const resize = controllerFor(store);

    resize.down(box, 'se', START, { x: 0, y: 0 });
    resize.move({ x: 40, y: 20 }, false); // past the 4px threshold: 140 x 70

    // Previewed only: present has the size, committed does not.
    expect(sizeOf(store, 'present', box)).toEqual({ width: px(140), height: px(70) });
    expect(sizeOf(store, 'committed', box)).toBeUndefined();

    resize.up();

    // Committed, and undoable as ONE entry.
    expect(sizeOf(store, 'committed', box)).toEqual({ width: px(140), height: px(70) });
    expect(store.getState().canUndo()).toBe(true);

    store.getState().undo();
    expect(sizeOf(store, 'committed', box)).toBeUndefined();
  });
});

describe('a cancelled resize', () => {
  it('reverts the preview and records nothing', () => {
    const { store, box } = buildStore();
    const resize = controllerFor(store);

    resize.down(box, 'se', START, { x: 0, y: 0 });
    resize.move({ x: 40, y: 20 }, false);
    expect(sizeOf(store, 'present', box)).toEqual({ width: px(140), height: px(70) });

    resize.cancel();

    expect(sizeOf(store, 'present', box)).toBeUndefined();
    expect(sizeOf(store, 'committed', box)).toBeUndefined();
    expect(store.getState().canUndo()).toBe(false);
  });
});

describe('a grab that is really a click', () => {
  it('does nothing when released below the threshold', () => {
    const { store, box } = buildStore();
    const resize = controllerFor(store);

    resize.down(box, 'se', START, { x: 0, y: 0 });
    resize.move({ x: 2, y: 1 }, false); // < 4px threshold
    resize.up();

    expect(sizeOf(store, 'committed', box)).toBeUndefined();
    expect(store.getState().canUndo()).toBe(false);
  });
});

describe('the active breakpoint', () => {
  it('writes the emulated breakpoint, not base', () => {
    const { store, box } = buildStore();
    const resize = controllerFor(store);
    store.getState().setActiveBreakpoint(MOBILE_BREAKPOINT_ID);

    resize.down(box, 'se', START, { x: 0, y: 0 });
    resize.move({ x: 40, y: 20 }, false);
    resize.up();

    expect(sizeOf(store, 'committed', box, target(BASE_BREAKPOINT_ID))).toBeUndefined();
    expect(sizeOf(store, 'committed', box, target(MOBILE_BREAKPOINT_ID))).toEqual({
      width: px(140),
      height: px(70),
    });
  });
});

describe('snapping', () => {
  /**
   * The controller never reads the DOM: the host answers "what can this node align
   * to?", so a stub provider is all a test needs. A vertical line at 143 sits 3px
   * from the right edge of the 140-wide box a (40, 20) drag produces.
   */
  function snapProvider(candidates: readonly SnapCandidate[]) {
    return () => ({ boxOrigin: { x: 0, y: 0 }, candidates });
  }

  const line: SnapCandidate = { axis: 'x', position: 143, kind: 'edge', from: 0, to: 300 };

  it('commits the SNAPPED size, so the aligned edge is what reaches the document', () => {
    const { store, box } = buildStore();
    const resize = createResizeController(store, {
      ids: createIdFactory(),
      snapFor: snapProvider([line]),
    });

    resize.down(box, 'se', START, { x: 0, y: 0 });
    resize.move({ x: 40, y: 20 }, false);
    resize.up();

    // 143, not the 140 the pointer named: the alignment is the edit, not a hint.
    expect(sizeOf(store, 'committed', box)).toEqual({ width: px(143), height: px(70) });
  });

  it('resizes exactly as before when the host offers no lines', () => {
    const { store, box } = buildStore();
    const resize = createResizeController(store, {
      ids: createIdFactory(),
      snapFor: () => null,
    });

    resize.down(box, 'se', START, { x: 0, y: 0 });
    resize.move({ x: 40, y: 20 }, false);
    resize.up();

    expect(sizeOf(store, 'committed', box)).toEqual({ width: px(140), height: px(70) });
  });

  it('reports the guides to draw while the resize is live', () => {
    const { store, box } = buildStore();
    const seen: (readonly SnapGuide[])[] = [];
    const resize = createResizeController(store, {
      ids: createIdFactory(),
      snapFor: snapProvider([line]),
      onGuidesChange: (guides) => seen.push(guides),
    });

    resize.down(box, 'se', START, { x: 0, y: 0 });
    resize.move({ x: 40, y: 20 }, false);

    expect(seen.at(-1)).toEqual([{ axis: 'x', position: 143, kind: 'edge', from: 0, to: 300 }]);
  });

  it('clears the guides on release, so no line outlives the gesture', () => {
    const { store, box } = buildStore();
    const seen: (readonly SnapGuide[])[] = [];
    const resize = createResizeController(store, {
      ids: createIdFactory(),
      snapFor: snapProvider([line]),
      onGuidesChange: (guides) => seen.push(guides),
    });

    resize.down(box, 'se', START, { x: 0, y: 0 });
    resize.move({ x: 40, y: 20 }, false);
    resize.up();

    expect(seen.at(-1)).toEqual([]);
  });

  it('clears the guides on cancel too', () => {
    const { store, box } = buildStore();
    const seen: (readonly SnapGuide[])[] = [];
    const resize = createResizeController(store, {
      ids: createIdFactory(),
      snapFor: snapProvider([line]),
      onGuidesChange: (guides) => seen.push(guides),
    });

    resize.down(box, 'se', START, { x: 0, y: 0 });
    resize.move({ x: 40, y: 20 }, false);
    resize.cancel();

    expect(seen.at(-1)).toEqual([]);
  });

  it('asks only about the node the gesture armed', () => {
    const { store, box } = buildStore();
    const asked: NodeId[] = [];
    const resize = createResizeController(store, {
      ids: createIdFactory(),
      snapFor: (nodeId) => {
        asked.push(nodeId);
        return null;
      },
    });

    resize.down(box, 'se', START, { x: 0, y: 0 });
    resize.move({ x: 40, y: 20 }, false);

    expect(asked).toEqual([box]);
  });

  it('measures nothing for a stray move with no gesture armed', () => {
    const { store } = buildStore();
    let asked = 0;
    const resize = createResizeController(store, {
      ids: createIdFactory(),
      snapFor: () => {
        asked += 1;
        return null;
      },
    });

    resize.move({ x: 40, y: 20 }, false);

    expect(asked).toBe(0);
  });
});

describe('phase notifications', () => {
  it('announces the resize starting and ending, for pointer capture and the shield', () => {
    const { store, box } = buildStore();
    const phases: boolean[] = [];
    const resize = createResizeController(store, {
      ids: createIdFactory(),
      onResizingChange: (r) => phases.push(r),
    });

    resize.down(box, 'se', START, { x: 0, y: 0 });
    resize.move({ x: 40, y: 20 }, false);
    resize.up();

    expect(phases).toEqual([true, false]);
  });

  it('does not announce a resize for a mere click', () => {
    const { store, box } = buildStore();
    const phases: boolean[] = [];
    const resize = createResizeController(store, {
      ids: createIdFactory(),
      onResizingChange: (r) => phases.push(r),
    });

    resize.down(box, 'se', START, { x: 0, y: 0 });
    resize.move({ x: 2, y: 1 }, false);
    resize.up();

    expect(phases).toEqual([]);
  });
});
