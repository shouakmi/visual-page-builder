import {
  BASE_BREAKPOINT_ID,
  BOX_COMPONENT_ID,
  HEADING_COMPONENT_ID,
  addPage,
  childIdsOf,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createNode,
  createPage,
  createProject,
  findRule,
  getComponent,
  getNode,
  nodeScope,
  propString,
  px,
  target,
  unsafeId,
  type ComponentId,
  type IdFactory,
  type NodeId,
  type Node,
  type PageId,
  type StyleRuleId,
} from '@vpb/core';
import { describe, expect, it } from 'vitest';

import { applyCommand, type Command, type EditorEnvironment } from '../command.ts';
import { insertNodeCommand, removeNodeCommand } from '../commands/nodeCommands.ts';
import { setNodePropCommand } from '../commands/propCommands.ts';
import { setStylePropertyCommand } from '../commands/styleCommands.ts';
import { activePage, createEditorState, select, type EditorState } from '../editorState.ts';
import {
  canRedo,
  canUndo,
  createHistory,
  entryFor,
  record,
  redo,
  redoLabel,
  undo,
  undoLabel,
  type History,
} from '../history.ts';

const registry = createBuiltinRegistry();
const env: EditorEnvironment = { registry };
const base = target(BASE_BREAKPOINT_ID);
const ruleId = (v: string) => unsafeId<StyleRuleId>(v);

function editor(): { state: EditorState; ids: IdFactory; pageId: PageId } {
  const ids = createDeterministicIdFactory();
  const project = createProject('Test', ids);
  const page = project.pages[0];
  if (!page) throw new Error('createProject must seed a page');
  return { state: createEditorState(project), ids, pageId: page.id };
}

function node(ids: IdFactory, component: ComponentId = BOX_COMPONENT_ID): Node {
  const definition = getComponent(registry, component);
  if (!definition) throw new Error(`registry is missing ${component}`);
  return createNode(definition, ids);
}

/** Run a command and record it, the way the store does. */
function commit(
  state: EditorState,
  history: History,
  command: Command,
  at: number,
): { state: EditorState; history: History } {
  const outcome = applyCommand(state, command, env);
  if (!outcome.ok) throw new Error(`refused: ${outcome.reason}`);
  return {
    state: outcome.state,
    history: record(history, entryFor(command, state, outcome.state, outcome.inverse, at)),
  };
}

const rootChildren = (s: EditorState) => childIdsOf(activePage(s).tree, activePage(s).tree.root);

describe('record', () => {
  it('stacks distinct edits', () => {
    const { state, ids } = editor();
    let current = commit(
      state,
      createHistory(),
      insertNodeCommand(node(ids), activePage(state).tree.root),
      0,
    );
    current = commit(
      current.state,
      current.history,
      insertNodeCommand(node(ids), activePage(state).tree.root),
      1000,
    );

    expect(current.history.past).toHaveLength(2);
    expect(canUndo(current.history)).toBe(true);
    expect(canRedo(current.history)).toBe(false);
  });

  it('caps the stack, dropping the oldest', () => {
    // "Unlimited undo" was the prototype's claim and its memory bug (AUDIT 4.3).
    const { state, ids } = editor();
    let current = { state, history: createHistory({ limit: 3 }) };

    for (let i = 0; i < 5; i++) {
      current = commit(
        current.state,
        current.history,
        insertNodeCommand(node(ids), activePage(current.state).tree.root),
        i * 1000,
      );
    }

    expect(current.history.past).toHaveLength(3);
    // The survivors are the newest three.
    expect(current.history.past.map((e) => e.kind)).toEqual([
      'insertNode',
      'insertNode',
      'insertNode',
    ]);
  });

  it('clears the redo branch on a new edit', () => {
    const { state, ids } = editor();
    const first = commit(
      state,
      createHistory(),
      insertNodeCommand(node(ids), activePage(state).tree.root),
      0,
    );
    const undone = undo(first.state, first.history, env);
    if (!undone) throw new Error('expected an undo');
    expect(canRedo(undone.history)).toBe(true);

    const branched = commit(
      undone.state,
      undone.history,
      insertNodeCommand(node(ids), activePage(undone.state).tree.root),
      1000,
    );
    expect(canRedo(branched.history)).toBe(false);
  });
});

describe('coalescing', () => {
  it('merges a run of edits to one property into one entry', () => {
    // AUDIT 4.3: updateCss committed on every character typed.
    const { state, ids } = editor();
    const heading = node(ids, HEADING_COMPONENT_ID);
    const seeded = commit(
      state,
      createHistory(),
      insertNodeCommand(heading, activePage(state).tree.root),
      0,
    );

    let current = seeded;
    for (const [i, text] of ['H', 'He', 'Hel', 'Hell', 'Hello'].entries()) {
      current = commit(
        current.state,
        current.history,
        setNodePropCommand(heading.id, 'text', propString(text)),
        1000 + i * 50,
      );
    }

    // One entry for the insert, one for all five keystrokes.
    expect(current.history.past).toHaveLength(2);
    expect(getNode(activePage(current.state).tree, heading.id)?.props.text).toEqual(
      propString('Hello'),
    );
  });

  it('undoes a coalesced run back to before the FIRST edit', () => {
    const { state, ids } = editor();
    const heading = node(ids, HEADING_COMPONENT_ID);
    const seeded = commit(
      state,
      createHistory(),
      insertNodeCommand(heading, activePage(state).tree.root),
      0,
    );
    const before = getNode(activePage(seeded.state).tree, heading.id)?.props.text;

    let current = seeded;
    for (const [i, text] of ['H', 'He', 'Hel'].entries()) {
      current = commit(
        current.state,
        current.history,
        setNodePropCommand(heading.id, 'text', propString(text)),
        1000 + i * 50,
      );
    }

    const undone = undo(current.state, current.history, env);
    if (!undone) throw new Error('expected an undo');
    expect(getNode(activePage(undone.state).tree, heading.id)?.props.text).toEqual(before);
  });

  it('redoes a coalesced run to after the LAST edit', () => {
    // Only valid because the coalescing commands assign rather than adjust.
    const { state, ids } = editor();
    const heading = node(ids, HEADING_COMPONENT_ID);
    const seeded = commit(
      state,
      createHistory(),
      insertNodeCommand(heading, activePage(state).tree.root),
      0,
    );

    let current = seeded;
    for (const [i, text] of ['H', 'He', 'Hel'].entries()) {
      current = commit(
        current.state,
        current.history,
        setNodePropCommand(heading.id, 'text', propString(text)),
        1000 + i * 50,
      );
    }

    const undone = undo(current.state, current.history, env);
    if (!undone) throw new Error('expected an undo');
    const redone = redo(undone.state, undone.history, env);
    if (!redone) throw new Error('expected a redo');

    expect(getNode(activePage(redone.state).tree, heading.id)?.props.text).toEqual(
      propString('Hel'),
    );
  });

  it('does not merge across the time window — a pause is an undo boundary', () => {
    const { state, ids } = editor();
    const heading = node(ids, HEADING_COMPONENT_ID);
    const seeded = commit(
      state,
      createHistory({ coalesceWindowMs: 500 }),
      insertNodeCommand(heading, activePage(state).tree.root),
      0,
    );

    const first = commit(
      seeded.state,
      seeded.history,
      setNodePropCommand(heading.id, 'text', propString('H')),
      1000,
    );
    const afterPause = commit(
      first.state,
      first.history,
      setNodePropCommand(heading.id, 'text', propString('He')),
      1000 + 501,
    );

    expect(afterPause.history.past).toHaveLength(3);
  });

  it('does not merge different properties even back to back', () => {
    const { state, ids } = editor();
    const box = node(ids);
    const seeded = commit(
      state,
      createHistory(),
      insertNodeCommand(box, activePage(state).tree.root),
      0,
    );

    const width = commit(
      seeded.state,
      seeded.history,
      setStylePropertyCommand(nodeScope(box.id), base, 'width', px(10), ruleId('r1')),
      1000,
    );
    const height = commit(
      width.state,
      width.history,
      setStylePropertyCommand(nodeScope(box.id), base, 'height', px(20), ruleId('r2')),
      1010,
    );

    expect(height.history.past).toHaveLength(3);
  });

  it('never merges structural edits, which carry no key', () => {
    const { state, ids } = editor();
    const a = node(ids);
    const b = node(ids);
    const first = commit(
      state,
      createHistory(),
      insertNodeCommand(a, activePage(state).tree.root),
      0,
    );
    const second = commit(
      first.state,
      first.history,
      insertNodeCommand(b, activePage(first.state).tree.root),
      1,
    );

    expect(second.history.past).toHaveLength(2);
  });
});

describe('undo / redo', () => {
  it('returns undefined with nothing to undo', () => {
    const { state } = editor();
    expect(undo(state, createHistory(), env)).toBeUndefined();
    expect(redo(state, createHistory(), env)).toBeUndefined();
  });

  it('round-trips a document through undo and redo', () => {
    const { state, ids } = editor();
    const box = node(ids);
    const before = rootChildren(state);

    const inserted = commit(
      state,
      createHistory(),
      insertNodeCommand(box, activePage(state).tree.root),
      0,
    );
    const after = rootChildren(inserted.state);

    const undone = undo(inserted.state, inserted.history, env);
    if (!undone) throw new Error('expected an undo');
    expect(rootChildren(undone.state)).toEqual(before);

    const redone = redo(undone.state, undone.history, env);
    if (!redone) throw new Error('expected a redo');
    expect(rootChildren(redone.state)).toEqual(after);
  });

  it('walks a multi-step timeline back and forward', () => {
    const { state, ids } = editor();
    const root = activePage(state).tree.root;
    const snapshots: (readonly NodeId[])[] = [rootChildren(state)];

    let current = { state, history: createHistory() };
    for (let i = 0; i < 3; i++) {
      current = commit(
        current.state,
        current.history,
        insertNodeCommand(node(ids), root),
        i * 1000,
      );
      snapshots.push(rootChildren(current.state));
    }

    for (let i = 3; i > 0; i--) {
      const step = undo(current.state, current.history, env);
      if (!step) throw new Error('expected an undo');
      current = step;
      expect(rootChildren(current.state)).toEqual(snapshots[i - 1]);
    }

    for (let i = 1; i <= 3; i++) {
      const step = redo(current.state, current.history, env);
      if (!step) throw new Error('expected a redo');
      current = step;
      expect(rootChildren(current.state)).toEqual(snapshots[i]);
    }
  });

  it('restores the selection an edit happened in', () => {
    // Not decoration: an undo that leaves the wrong node selected retargets the
    // user's next edit.
    const { state, ids } = editor();
    const box = node(ids);
    const seeded = commit(
      state,
      createHistory(),
      insertNodeCommand(box, activePage(state).tree.root),
      0,
    );

    // Select the box, then delete it. The delete drops it from the selection.
    const selected = select(seeded.state, [box.id]);
    const deleted = commit(selected, seeded.history, removeNodeCommand(box.id), 1000);
    expect(deleted.state.context.selection).toEqual([]);

    const undone = undo(deleted.state, deleted.history, env);
    if (!undone) throw new Error('expected an undo');
    expect(undone.state.context.selection).toEqual([box.id]);
  });

  /**
   * The recorded context OUTRANKS whatever the inverse command selects.
   *
   * The test above cannot tell the difference: undoing a delete runs
   * `insertSubtreeCommand`, which selects the node it restores — the same answer
   * the recorded context gives, by coincidence. This one separates them. Undoing
   * an INSERT runs `removeNodeCommand`, whose own selection ends up empty, while
   * the context recorded before the insert had a different node selected. Only a
   * real restore returns the user to `first`.
   */
  it('restores the recorded selection even when the inverse selects something else', () => {
    const { state, ids } = editor();
    const root = activePage(state).tree.root;
    const first = node(ids);
    const seeded = commit(state, createHistory(), insertNodeCommand(first, root), 0);

    // Put the selection somewhere the inverse will not put it back.
    const selected = select(seeded.state, [first.id]);
    expect(selected.context.selection).toEqual([first.id]);

    const second = node(ids);
    const inserted = commit(selected, seeded.history, insertNodeCommand(second, root), 1000);
    expect(inserted.state.context.selection).toEqual([second.id]);

    const undone = undo(inserted.state, inserted.history, env);
    if (!undone) throw new Error('expected an undo');
    expect(undone.state.context.selection).toEqual([first.id]);
  });

  it('undoes onto the page the edit happened on, not the page being viewed', () => {
    /*
     * Commands act on the ACTIVE page. Undoing while the user has navigated
     * elsewhere would otherwise apply the inverse to the wrong tree — silently
     * editing a page they are not looking at.
     */
    const ids = createDeterministicIdFactory();
    let project = createProject('Test', ids);
    const home = project.pages[0];
    if (!home) throw new Error('unreachable');
    const about = createPage('About', '/about', ids);
    project = addPage(project, about);

    const state = createEditorState(project);
    const box = node(ids);
    const inserted = commit(
      state,
      createHistory(),
      insertNodeCommand(box, activePage(state).tree.root),
      0,
    );

    // Navigate to the other page, then undo.
    const elsewhere: EditorState = {
      ...inserted.state,
      context: { ...inserted.state.context, activePageId: about.id, selection: [] },
    };
    const undone = undo(elsewhere, inserted.history, env);
    if (!undone) throw new Error('expected an undo');

    // The insert is gone from HOME, and About is untouched.
    const homePage = undone.state.project.pages.find((p) => p.id === home.id);
    const aboutPage = undone.state.project.pages.find((p) => p.id === about.id);
    expect(homePage && getNode(homePage.tree, box.id)).toBeUndefined();
    expect(aboutPage && aboutPage.tree.nodes.size).toBe(1);
    expect(undone.state.context.activePageId).toBe(home.id);
  });

  it('restores a deleted subtree and its style rules together', () => {
    const { state, ids } = editor();
    const box = node(ids);
    const seeded = commit(
      state,
      createHistory(),
      insertNodeCommand(box, activePage(state).tree.root),
      0,
    );
    const styled = commit(
      seeded.state,
      seeded.history,
      setStylePropertyCommand(nodeScope(box.id), base, 'width', px(100), ruleId('r1')),
      1000,
    );
    const deleted = commit(styled.state, styled.history, removeNodeCommand(box.id), 2000);
    expect(findRule(deleted.state.project.styles, nodeScope(box.id), base)).toBeUndefined();

    const undone = undo(deleted.state, deleted.history, env);
    if (!undone) throw new Error('expected an undo');
    expect(
      findRule(undone.state.project.styles, nodeScope(box.id), base)?.declarations.width,
    ).toEqual(px(100));
  });

  it('throws rather than silently diverging if a recorded inverse cannot apply', () => {
    const { state } = editor();
    const broken: Command = {
      kind: 'broken',
      label: 'Broken',
      apply: () => ({ ok: false, reason: 'nope' }),
    };
    const history: History = {
      ...createHistory(),
      past: [
        {
          kind: 'broken',
          label: 'Broken',
          undo: broken,
          redo: broken,
          contextBefore: state.context,
          contextAfter: state.context,
          at: 0,
        },
      ],
    };

    expect(() => undo(state, history, env)).toThrow(/history and the document have diverged/);
  });
});

describe('labels', () => {
  it('name what undo and redo would do', () => {
    const { state, ids } = editor();
    const inserted = commit(
      state,
      createHistory(),
      insertNodeCommand(node(ids), activePage(state).tree.root),
      0,
    );

    expect(undoLabel(inserted.history)).toBe('Insert');
    expect(redoLabel(inserted.history)).toBeUndefined();

    const undone = undo(inserted.state, inserted.history, env);
    if (!undone) throw new Error('expected an undo');
    expect(undoLabel(undone.history)).toBeUndefined();
    expect(redoLabel(undone.history)).toBe('Insert');
  });
});
