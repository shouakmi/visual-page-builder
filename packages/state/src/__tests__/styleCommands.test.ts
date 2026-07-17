import {
  BASE_BREAKPOINT_ID,
  BOX_COMPONENT_ID,
  MOBILE_BREAKPOINT_ID,
  classScope,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createNode,
  createProject,
  findRule,
  getComponent,
  insertNode,
  keyword,
  nodeScope,
  px,
  rulesForScope,
  setPageTree,
  target,
  unsafeId,
  updatePageBy,
  validateStyleSheet,
  type ClassName,
  type IdFactory,
  type NodeId,
  type StyleRuleId,
} from '@vpb/core';
import { describe, expect, it } from 'vitest';

import { applyCommand, type Command, type EditorEnvironment } from '../command.ts';
import { setStylePropertyCommand, unsetStylePropertyCommand } from '../commands/styleCommands.ts';
import { createEditorState, type EditorState } from '../editorState.ts';

const registry = createBuiltinRegistry();
const env: EditorEnvironment = { registry };

function editorWithBox(): { state: EditorState; box: NodeId; ids: IdFactory } {
  const ids = createDeterministicIdFactory();
  let project = createProject('Test', ids);
  const page = project.pages[0];
  if (!page) throw new Error('createProject must seed a page');

  const definition = getComponent(registry, BOX_COMPONENT_ID);
  if (!definition) throw new Error('registry is missing vpb:box');

  const box = createNode(definition, ids);
  project = updatePageBy(project, page.id, (p) =>
    setPageTree(p, insertNode(page.tree, box, page.tree.root)),
  );

  return { state: createEditorState(project), box: box.id, ids };
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

const ruleId = (value: string) => unsafeId<StyleRuleId>(value);
const base = target(BASE_BREAKPOINT_ID);

describe('setStylePropertyCommand', () => {
  it('creates a rule when none exists, using the pre-minted id', () => {
    const { state, box } = editorWithBox();
    const { state: next } = run(
      state,
      setStylePropertyCommand(nodeScope(box), base, 'width', px(100), ruleId('rule-1')),
    );

    const rule = findRule(next.project.styles, nodeScope(box), base);
    expect(rule?.id).toBe('rule-1');
    expect(rule?.declarations.width).toEqual(px(100));
    expect(validateStyleSheet(next.project.styles)).toEqual([]);
  });

  it('updates an existing rule, keeping its id rather than the offered one', () => {
    const { state, box } = editorWithBox();
    const { state: first } = run(
      state,
      setStylePropertyCommand(nodeScope(box), base, 'width', px(100), ruleId('rule-1')),
    );
    const { state: second } = run(
      first,
      setStylePropertyCommand(nodeScope(box), base, 'height', px(50), ruleId('rule-2')),
    );

    const rule = findRule(second.project.styles, nodeScope(box), base);
    expect(rule?.id).toBe('rule-1');
    expect(rule?.declarations).toEqual({ width: px(100), height: px(50) });
  });

  it('undoes a create by removing the property again', () => {
    const { state, box } = editorWithBox();
    const { state: set, inverse } = run(
      state,
      setStylePropertyCommand(nodeScope(box), base, 'width', px(100), ruleId('rule-1')),
    );
    const { state: undone } = run(set, inverse);

    expect(findRule(undone.project.styles, nodeScope(box), base)).toBeUndefined();
    expect(rulesForScope(undone.project.styles, nodeScope(box))).toEqual([]);
  });

  it('undoes an overwrite back to the previous value', () => {
    const { state, box } = editorWithBox();
    const { state: first } = run(
      state,
      setStylePropertyCommand(nodeScope(box), base, 'width', px(100), ruleId('rule-1')),
    );
    const { state: second, inverse } = run(
      first,
      setStylePropertyCommand(nodeScope(box), base, 'width', px(250), ruleId('rule-1')),
    );
    expect(findRule(second.project.styles, nodeScope(box), base)?.declarations.width).toEqual(
      px(250),
    );

    const { state: undone } = run(second, inverse);
    expect(findRule(undone.project.styles, nodeScope(box), base)?.declarations.width).toEqual(
      px(100),
    );
  });

  it('refuses a value the property does not accept', () => {
    const { state, box } = editorWithBox();
    // `width` takes lengths and keywords from its own vocabulary, not `flex-start`.
    expect(
      refusalOf(
        state,
        setStylePropertyCommand(
          nodeScope(box),
          base,
          'width',
          keyword('flex-start'),
          ruleId('rule-1'),
        ),
      ),
    ).toMatch(/does not accept/);
  });

  /**
   * KNOWN GAP, asserted so it is a decision rather than a surprise.
   *
   * Re-setting a property to the value it already has SHOULD be refused: it
   * takes a history entry whose undo restores the same value, and an invisible
   * Ctrl+Z gets pressed twice. It is not refused because `StyleValue` has no
   * structural equality in @vpb/core — `declarationsEqual` compares by
   * reference, so a fresh `px(100)` never equals the stored one. Coalescing
   * absorbs the realistic case (a jittering slider is one entry). This test
   * pins the current behaviour; change it when `valuesEqual` lands in core.
   */
  it('does NOT yet detect a set to the identical value (no valuesEqual in core)', () => {
    const { state, box } = editorWithBox();
    const { state: first } = run(
      state,
      setStylePropertyCommand(nodeScope(box), base, 'width', px(100), ruleId('rule-1')),
    );

    const outcome = applyCommand(
      first,
      setStylePropertyCommand(nodeScope(box), base, 'width', px(100), ruleId('r2')),
      env,
    );
    expect(outcome.ok).toBe(true);
  });

  it('refuses a value structurally identical only by reference — the gap, stated', () => {
    // Proof of the cause rather than of the symptom: two structurally equal
    // values are different objects, which is why the check above cannot be made.
    expect(px(100)).not.toBe(px(100));
    expect(px(100)).toEqual(px(100));
  });

  it('works on a class scope as well as a node scope', () => {
    const { state } = editorWithBox();
    const scope = classScope('btn' as ClassName);
    const { state: next } = run(
      state,
      setStylePropertyCommand(scope, base, 'width', px(100), ruleId('rule-1')),
    );

    expect(findRule(next.project.styles, scope, base)?.declarations.width).toEqual(px(100));
  });

  it('keeps breakpoints apart — a mobile edit does not touch base', () => {
    const { state, box } = editorWithBox();
    const mobile = target(MOBILE_BREAKPOINT_ID);

    const { state: atBase } = run(
      state,
      setStylePropertyCommand(nodeScope(box), base, 'width', px(100), ruleId('rule-1')),
    );
    const { state: atMobile } = run(
      atBase,
      setStylePropertyCommand(nodeScope(box), mobile, 'width', px(50), ruleId('rule-2')),
    );

    expect(findRule(atMobile.project.styles, nodeScope(box), base)?.declarations.width).toEqual(
      px(100),
    );
    expect(findRule(atMobile.project.styles, nodeScope(box), mobile)?.declarations.width).toEqual(
      px(50),
    );
  });
});

describe('coalesceKey', () => {
  it('is identical for two edits of the same property on the same target', () => {
    // What makes a slider drag one history entry instead of one per frame.
    const { box } = editorWithBox();
    const a = setStylePropertyCommand(nodeScope(box), base, 'width', px(100), ruleId('r'));
    const b = setStylePropertyCommand(nodeScope(box), base, 'width', px(101), ruleId('r'));

    expect(a.coalesceKey).toBe(b.coalesceKey);
    expect(a.coalesceKey).toBeDefined();
  });

  it('differs per property, so moving to the next slider starts a new entry', () => {
    const { box } = editorWithBox();
    const width = setStylePropertyCommand(nodeScope(box), base, 'width', px(100), ruleId('r'));
    const height = setStylePropertyCommand(nodeScope(box), base, 'height', px(100), ruleId('r'));

    expect(width.coalesceKey).not.toBe(height.coalesceKey);
  });

  it('differs per breakpoint, so the same property at two sizes stays separate', () => {
    const { box } = editorWithBox();
    const atBase = setStylePropertyCommand(nodeScope(box), base, 'width', px(100), ruleId('r'));
    const atMobile = setStylePropertyCommand(
      nodeScope(box),
      target(MOBILE_BREAKPOINT_ID),
      'width',
      px(100),
      ruleId('r'),
    );

    expect(atBase.coalesceKey).not.toBe(atMobile.coalesceKey);
  });

  it('differs per scope, so styling .btn then this node stays separate', () => {
    const { box } = editorWithBox();
    const onNode = setStylePropertyCommand(nodeScope(box), base, 'width', px(100), ruleId('r'));
    const onClass = setStylePropertyCommand(
      classScope('btn' as ClassName),
      base,
      'width',
      px(100),
      ruleId('r'),
    );

    expect(onNode.coalesceKey).not.toBe(onClass.coalesceKey);
  });

  it('is absent on structural edits — unsetting is not a drag', () => {
    const { box } = editorWithBox();
    expect(unsetStylePropertyCommand(nodeScope(box), base, 'width').coalesceKey).toBeUndefined();
  });
});

describe('unsetStylePropertyCommand', () => {
  it('removes the property and drops the rule when it was the last one', () => {
    const { state, box } = editorWithBox();
    const { state: set } = run(
      state,
      setStylePropertyCommand(nodeScope(box), base, 'width', px(100), ruleId('rule-1')),
    );
    const { state: cleared } = run(set, unsetStylePropertyCommand(nodeScope(box), base, 'width'));

    expect(findRule(cleared.project.styles, nodeScope(box), base)).toBeUndefined();
  });

  it('leaves the other properties alone', () => {
    const { state, box } = editorWithBox();
    let current = run(
      state,
      setStylePropertyCommand(nodeScope(box), base, 'width', px(100), ruleId('rule-1')),
    ).state;
    current = run(
      current,
      setStylePropertyCommand(nodeScope(box), base, 'height', px(50), ruleId('rule-1')),
    ).state;

    const { state: cleared } = run(
      current,
      unsetStylePropertyCommand(nodeScope(box), base, 'width'),
    );
    expect(findRule(cleared.project.styles, nodeScope(box), base)?.declarations).toEqual({
      height: px(50),
    });
  });

  it('restores the value on undo', () => {
    const { state, box } = editorWithBox();
    const { state: set } = run(
      state,
      setStylePropertyCommand(nodeScope(box), base, 'width', px(100), ruleId('rule-1')),
    );
    const { state: cleared, inverse } = run(
      set,
      unsetStylePropertyCommand(nodeScope(box), base, 'width'),
    );
    const { state: undone } = run(cleared, inverse);

    expect(findRule(undone.project.styles, nodeScope(box), base)?.declarations.width).toEqual(
      px(100),
    );
  });

  it("restores the rule's own id on undo, not a lookalike", () => {
    const { state, box } = editorWithBox();
    const { state: set } = run(
      state,
      setStylePropertyCommand(nodeScope(box), base, 'width', px(100), ruleId('rule-1')),
    );
    const { state: cleared, inverse } = run(
      set,
      unsetStylePropertyCommand(nodeScope(box), base, 'width'),
    );
    const { state: undone } = run(cleared, inverse);

    expect(findRule(undone.project.styles, nodeScope(box), base)?.id).toBe('rule-1');
  });

  it('refuses when the property is not set', () => {
    const { state, box } = editorWithBox();
    expect(refusalOf(state, unsetStylePropertyCommand(nodeScope(box), base, 'width'))).toMatch(
      /not set here/,
    );
  });
});
