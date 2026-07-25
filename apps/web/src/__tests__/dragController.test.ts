import {
  BOX_COMPONENT_ID,
  SECTION_COMPONENT_ID,
  childrenOf,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createNode,
  createProject,
  getComponent,
  insertNode,
  setPageTree,
  updatePageBy,
  type ComponentId,
  type IdFactory,
  type Node,
  type NodeId,
} from '@vpb/core';
import type { Drop } from '@vpb/interaction';
import { activePage, createEditorStore } from '@vpb/state';
import { describe, expect, it } from 'vitest';

import { createDragController } from '../dragController.ts';

/**
 * The controller drives a REAL store — no DOM, because the drop is handed in rather
 * than measured. So the whole preview/commit/cancel contract is asserted here: a
 * drag previews on `present`, commits to history on release, and a cancelled or
 * sub-threshold press leaves the document and the undo stack untouched.
 */

const registry = createBuiltinRegistry();

function make(ids: IdFactory, component: ComponentId): Node {
  const definition = getComponent(registry, component);
  if (!definition) throw new Error(`registry is missing ${component}`);
  return createNode(definition, ids);
}

/** body > section > [a, b, c]. */
function buildStore() {
  const ids = createDeterministicIdFactory();
  let project = createProject('Test', ids);
  const home = project.pages[0];
  if (!home) throw new Error('createProject always seeds a page');

  const section = make(ids, SECTION_COMPONENT_ID);
  const a = make(ids, BOX_COMPONENT_ID);
  const b = make(ids, BOX_COMPONENT_ID);
  const c = make(ids, BOX_COMPONENT_ID);
  let tree = home.tree;
  tree = insertNode(tree, section, tree.root);
  tree = insertNode(tree, a, section.id);
  tree = insertNode(tree, b, section.id);
  tree = insertNode(tree, c, section.id);
  project = updatePageBy(project, home.id, (page) => setPageTree(page, tree));

  const store = createEditorStore({ project, env: { registry } });
  return { store, section: section.id, a: a.id, b: b.id, c: c.id };
}

function order(
  store: ReturnType<typeof createEditorStore>,
  which: 'present' | 'committed',
  parent: NodeId,
) {
  const state = which === 'present' ? store.getState().present : store.getState().committed;
  return childrenOf(activePage(state).tree, parent).map((node) => node.id);
}

/** A drop that appends within the section (index past the last child). */
function toEnd(section: NodeId): Drop {
  return { parentId: section, index: 3 };
}

describe('a completed drag', () => {
  it('previews the move on present, then commits it to history on release', () => {
    const { store, section, a, b, c } = buildStore();
    const drag = createDragController(store);

    drag.down(a, { x: 0, y: 0 });
    drag.move({ x: 0, y: 20 }, toEnd(section)); // past the 4px threshold

    // Previewed only: present has moved, committed has not.
    expect(order(store, 'present', section)).toEqual([b, c, a]);
    expect(order(store, 'committed', section)).toEqual([a, b, c]);

    drag.up();

    // Committed, and undoable as ONE entry.
    expect(order(store, 'committed', section)).toEqual([b, c, a]);
    expect(store.getState().canUndo()).toBe(true);
  });
});

describe('a cancelled drag', () => {
  it('reverts the preview and records nothing', () => {
    const { store, section, a, b, c } = buildStore();
    const drag = createDragController(store);

    drag.down(a, { x: 0, y: 0 });
    drag.move({ x: 0, y: 20 }, toEnd(section));
    expect(order(store, 'present', section)).toEqual([b, c, a]);

    drag.cancel();

    expect(order(store, 'present', section)).toEqual([a, b, c]);
    expect(order(store, 'committed', section)).toEqual([a, b, c]);
    expect(store.getState().canUndo()).toBe(false);
  });
});

describe('a press that is really a click', () => {
  it('does nothing when released below the threshold', () => {
    const { store, section, a, b, c } = buildStore();
    const drag = createDragController(store);

    drag.down(a, { x: 0, y: 0 });
    drag.move({ x: 0, y: 2 }, toEnd(section)); // 2px < 4px threshold
    drag.up();

    expect(order(store, 'committed', section)).toEqual([a, b, c]);
    expect(store.getState().canUndo()).toBe(false);
  });
});

describe('an invalid hover', () => {
  it('clears the preview so the node snaps back while the drag continues', () => {
    const { store, section, a, b, c } = buildStore();
    const drag = createDragController(store);

    drag.down(a, { x: 0, y: 0 });
    drag.move({ x: 0, y: 20 }, toEnd(section));
    expect(order(store, 'present', section)).toEqual([b, c, a]);

    drag.move({ x: 0, y: 40 }, null); // over nothing droppable
    expect(order(store, 'present', section)).toEqual([a, b, c]);
    expect(drag.isDragging()).toBe(true);
  });
});

describe('phase notifications', () => {
  it('announces the drag starting and ending, for pointer capture and the shield', () => {
    const { store, section, a } = buildStore();
    const phases: boolean[] = [];
    const drag = createDragController(store, { onDraggingChange: (d) => phases.push(d) });

    drag.down(a, { x: 0, y: 0 });
    drag.move({ x: 0, y: 20 }, toEnd(section));
    drag.up();

    expect(phases).toEqual([true, false]);
  });

  it('does not announce a drag for a mere click', () => {
    const { store, section, a } = buildStore();
    const phases: boolean[] = [];
    const drag = createDragController(store, { onDraggingChange: (d) => phases.push(d) });

    drag.down(a, { x: 0, y: 0 });
    drag.move({ x: 0, y: 2 }, toEnd(section));
    drag.up();

    expect(phases).toEqual([]);
  });
});
