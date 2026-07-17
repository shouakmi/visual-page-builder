import {
  BASE_BREAKPOINT_ID,
  BOX_COMPONENT_ID,
  HEADING_COMPONENT_ID,
  classScope,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createNode,
  createProject,
  getNode,
  getComponent,
  insertNode,
  nodeName,
  propString,
  propNumber,
  px,
  resolveProperty,
  setPageTree,
  setProperty,
  target,
  updatePageBy,
  type ClassName,
  type IdFactory,
  type NodeId,
} from '@vpb/core';
import { describe, expect, it } from 'vitest';

import { applyCommand, type Command, type EditorEnvironment } from '../command.ts';
import {
  addClassCommand,
  removeClassCommand,
  renameNodeCommand,
  setNodeClassesCommand,
  setNodePropCommand,
  unsetNodePropCommand,
} from '../commands/propCommands.ts';
import { activePage, createEditorState, type EditorState } from '../editorState.ts';

const registry = createBuiltinRegistry();
const env: EditorEnvironment = { registry };

function editorWith(componentId: typeof BOX_COMPONENT_ID): {
  state: EditorState;
  node: NodeId;
  ids: IdFactory;
} {
  const ids = createDeterministicIdFactory();
  let project = createProject('Test', ids);
  const page = project.pages[0];
  if (!page) throw new Error('createProject must seed a page');

  const definition = getComponent(registry, componentId);
  if (!definition) throw new Error(`registry is missing ${componentId}`);

  const node = createNode(definition, ids);
  project = updatePageBy(project, page.id, (p) =>
    setPageTree(p, insertNode(page.tree, node, page.tree.root)),
  );

  return { state: createEditorState(project), node: node.id, ids };
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

const nodeIn = (state: EditorState, id: NodeId) => getNode(activePage(state).tree, id);

describe('setNodePropCommand', () => {
  it('sets a prop the component declares', () => {
    const { state, node } = editorWith(HEADING_COMPONENT_ID);
    const { state: next } = run(state, setNodePropCommand(node, 'text', propString('Hello')));

    expect(nodeIn(next, node)?.props.text).toEqual(propString('Hello'));
  });

  it('refuses a prop the component does not declare', () => {
    // A typo would otherwise write a prop no renderer reads and no panel shows.
    const { state, node } = editorWith(HEADING_COMPONENT_ID);
    expect(refusalOf(state, setNodePropCommand(node, 'txet', propString('Hello')))).toMatch(
      /has no prop "txet"/,
    );
  });

  it('refuses a value of the wrong kind for the prop', () => {
    const { state, node } = editorWith(HEADING_COMPONENT_ID);
    expect(refusalOf(state, setNodePropCommand(node, 'text', propNumber(42)))).toMatch(
      /does not accept/,
    );
  });

  it('refuses an unknown node', () => {
    const { state } = editorWith(HEADING_COMPONENT_ID);
    expect(
      refusalOf(state, setNodePropCommand('ghost' as NodeId, 'text', propString('x'))),
    ).toMatch(/not in the tree/);
  });

  it('undoes a first set by unsetting', () => {
    const { state, node } = editorWith(HEADING_COMPONENT_ID);
    const before = nodeIn(state, node)?.props.text;

    const { state: set, inverse } = run(state, setNodePropCommand(node, 'text', propString('Hi')));
    const { state: undone } = run(set, inverse);

    expect(nodeIn(undone, node)?.props.text).toEqual(before);
  });

  it('undoes an overwrite back to the previous value', () => {
    const { state, node } = editorWith(HEADING_COMPONENT_ID);
    const { state: first } = run(state, setNodePropCommand(node, 'text', propString('One')));
    const { state: second, inverse } = run(
      first,
      setNodePropCommand(node, 'text', propString('Two')),
    );

    const { state: undone } = run(second, inverse);
    expect(nodeIn(undone, node)?.props.text).toEqual(propString('One'));
  });

  it('coalesces per node and prop, so typing is one entry', () => {
    const { state, node } = editorWith(HEADING_COMPONENT_ID);
    const a = setNodePropCommand(node, 'text', propString('H'));
    const b = setNodePropCommand(node, 'text', propString('He'));

    expect(a.coalesceKey).toBe(b.coalesceKey);
    expect(a.coalesceKey).toBeDefined();
    void state;
  });

  it('does not coalesce across different props', () => {
    const { node } = editorWith(HEADING_COMPONENT_ID);
    const text = setNodePropCommand(node, 'text', propString('H'));
    const level = setNodePropCommand(node, 'level', propNumber(2));

    expect(text.coalesceKey).not.toBe(level.coalesceKey);
  });
});

describe('unsetNodePropCommand', () => {
  it('refuses when the prop is not set', () => {
    const { state, node } = editorWith(BOX_COMPONENT_ID);
    expect(refusalOf(state, unsetNodePropCommand(node, 'nope'))).toMatch(/no prop/);
  });

  it('restores the value on undo', () => {
    const { state, node } = editorWith(HEADING_COMPONENT_ID);
    const { state: set } = run(state, setNodePropCommand(node, 'text', propString('Hi')));
    const { state: cleared, inverse } = run(set, unsetNodePropCommand(node, 'text'));
    const { state: undone } = run(cleared, inverse);

    expect(nodeIn(undone, node)?.props.text).toEqual(propString('Hi'));
  });
});

describe('renameNodeCommand', () => {
  it('renames the node', () => {
    const { state, node } = editorWith(BOX_COMPONENT_ID);
    const { state: next } = run(state, renameNodeCommand(node, 'Hero'));
    expect(nodeIn(next, node)?.name).toBe('Hero');
  });

  it('undoes back to unnamed, restoring the component label', () => {
    const { state, node } = editorWith(BOX_COMPONENT_ID);
    const definition = getComponent(registry, BOX_COMPONENT_ID);
    if (!definition) throw new Error('unreachable');

    const { state: renamed, inverse } = run(state, renameNodeCommand(node, 'Hero'));
    const { state: undone } = run(renamed, inverse);

    expect(nodeIn(undone, node)?.name).toBeUndefined();
    expect(nodeName(nodeIn(undone, node) as never, definition)).toBe(definition.label);
  });

  it('refuses a rename that changes nothing', () => {
    const { state, node } = editorWith(BOX_COMPONENT_ID);
    const { state: renamed } = run(state, renameNodeCommand(node, 'Hero'));
    expect(refusalOf(renamed, renameNodeCommand(node, 'Hero'))).toMatch(/unchanged/);
  });
});

describe('class commands', () => {
  const a = 'alpha' as ClassName;
  const b = 'beta' as ClassName;
  const c = 'gamma' as ClassName;

  it('adds a class', () => {
    const { state, node } = editorWith(BOX_COMPONENT_ID);
    const { state: next } = run(state, addClassCommand(node, a));
    expect(nodeIn(next, node)?.classes).toEqual([a]);
  });

  it('refuses an invalid class name rather than sanitising it', () => {
    // A class name reaches the exported CSS as an identifier.
    const { state, node } = editorWith(BOX_COMPONENT_ID);
    expect(refusalOf(state, addClassCommand(node, '2 bad name!' as ClassName))).toMatch(
      /not a valid class name/,
    );
  });

  it('refuses a duplicate', () => {
    const { state, node } = editorWith(BOX_COMPONENT_ID);
    const { state: next } = run(state, addClassCommand(node, a));
    expect(refusalOf(next, addClassCommand(node, a))).toMatch(/already has/);
  });

  it('undoes an add by removing it', () => {
    const { state, node } = editorWith(BOX_COMPONENT_ID);
    const { state: added, inverse } = run(state, addClassCommand(node, a));
    const { state: undone } = run(added, inverse);
    expect(nodeIn(undone, node)?.classes).toEqual([]);
  });

  it('removes a class, leaving the others', () => {
    const { state, node } = editorWith(BOX_COMPONENT_ID);
    const { state: withAll } = run(state, setNodeClassesCommand(node, [a, b, c]));
    const { state: next } = run(withAll, removeClassCommand(node, b));
    expect(nodeIn(next, node)?.classes).toEqual([a, c]);
  });

  /**
   * The class list is ordered and the user sees it as chips, so an undo that
   * appends rather than restores has not restored what was there — and the
   * exported `class="..."` attribute would differ too.
   */
  it('restores a removed class to its original POSITION, not the end', () => {
    const { state, node } = editorWith(BOX_COMPONENT_ID);
    const { state: withAll } = run(state, setNodeClassesCommand(node, [a, b, c]));

    const { state: removed, inverse } = run(withAll, removeClassCommand(node, a));
    expect(nodeIn(removed, node)?.classes).toEqual([b, c]);

    const { state: undone } = run(removed, inverse);
    expect(nodeIn(undone, node)?.classes).toEqual([a, b, c]);
  });

  /**
   * The element's class order does NOT decide the winner — `sheet.classOrder`
   * does, exactly as a browser ranks by the stylesheet and ignores the `class`
   * attribute. Asserted through the resolver rather than by eyeballing the array,
   * and asserted for BOTH orders, because a per-element ranking is the thing the
   * emitter could never reproduce.
   */
  it('the class list order does not change which class wins', () => {
    const { state, node, ids } = editorWith(BOX_COMPONENT_ID);
    const base = target(BASE_BREAKPOINT_ID);

    // .alpha styled first, then .beta -> the SHEET ranks .beta stronger.
    let styles = setProperty(state.project.styles, classScope(a), base, 'width', px(10), ids);
    styles = setProperty(styles, classScope(b), base, 'width', px(20), ids);
    const styled: EditorState = { ...state, project: { ...state.project, styles } };

    const widthOf = (s: EditorState, classes: readonly ClassName[]) =>
      resolveProperty(
        s.project.styles,
        { classes, nodeId: node },
        base,
        'width',
        s.project.breakpoints,
      )?.value;

    const { state: forward } = run(styled, setNodeClassesCommand(node, [a, b]));
    const { state: reversed } = run(forward, setNodeClassesCommand(node, [b, a]));

    expect(widthOf(forward, [a, b])).toEqual(px(20));
    expect(widthOf(reversed, [b, a])).toEqual(px(20));
  });

  it('undoing a class removal restores the list exactly', () => {
    const { state, node, ids } = editorWith(BOX_COMPONENT_ID);
    const base = target(BASE_BREAKPOINT_ID);
    const styles = setProperty(state.project.styles, classScope(a), base, 'width', px(10), ids);
    const styled: EditorState = { ...state, project: { ...state.project, styles } };

    const { state: withAll } = run(styled, setNodeClassesCommand(node, [a, b]));
    const { state: removed, inverse } = run(withAll, removeClassCommand(node, a));
    const { state: undone } = run(removed, inverse);

    expect(nodeIn(undone, node)?.classes).toEqual([a, b]);
  });

  it('leaves the class rules alone — removing from one node must not restyle others', () => {
    const { state, node, ids } = editorWith(BOX_COMPONENT_ID);
    const base = target(BASE_BREAKPOINT_ID);
    const styles = setProperty(state.project.styles, classScope(a), base, 'width', px(10), ids);
    const styled: EditorState = { ...state, project: { ...state.project, styles } };

    const { state: added } = run(styled, addClassCommand(node, a));
    const { state: removed } = run(added, removeClassCommand(node, a));

    expect(findRuleWidth(removed)).toEqual(px(10));

    function findRuleWidth(s: EditorState) {
      return resolveProperty(
        s.project.styles,
        { classes: [a], nodeId: null },
        base,
        'width',
        s.project.breakpoints,
      )?.value;
    }
  });

  it('refuses removing a class the node does not have', () => {
    const { state, node } = editorWith(BOX_COMPONENT_ID);
    expect(refusalOf(state, removeClassCommand(node, a))).toMatch(/does not have/);
  });
});

describe('setNodeClassesCommand', () => {
  const a = 'alpha' as ClassName;
  const b = 'beta' as ClassName;

  it('replaces the whole list', () => {
    const { state, node } = editorWith(BOX_COMPONENT_ID);
    const { state: next } = run(state, setNodeClassesCommand(node, [a, b]));
    expect(nodeIn(next, node)?.classes).toEqual([a, b]);
  });

  it('round-trips a reorder, which is a real style change', () => {
    const { state, node } = editorWith(BOX_COMPONENT_ID);
    const { state: first } = run(state, setNodeClassesCommand(node, [a, b]));
    const { state: swapped, inverse } = run(first, setNodeClassesCommand(node, [b, a]));

    expect(nodeIn(swapped, node)?.classes).toEqual([b, a]);
    const { state: undone } = run(swapped, inverse);
    expect(nodeIn(undone, node)?.classes).toEqual([a, b]);
  });

  it('refuses an invalid name anywhere in the list', () => {
    const { state, node } = editorWith(BOX_COMPONENT_ID);
    expect(refusalOf(state, setNodeClassesCommand(node, [a, '!bad' as ClassName]))).toMatch(
      /Invalid class name/,
    );
  });

  it('refuses a no-op', () => {
    const { state, node } = editorWith(BOX_COMPONENT_ID);
    const { state: next } = run(state, setNodeClassesCommand(node, [a]));
    expect(refusalOf(next, setNodeClassesCommand(node, [a]))).toMatch(/unchanged/);
  });
});
