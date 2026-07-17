/**
 * PHASE C — commands, history, store.
 *
 * AUDIT §4.3 and §7.3 are the source of most of these: the prototype's history
 * snapshotted the whole document per keystroke, undid clicks, and had no cap,
 * because there was no Command interface and no inverse ops to build on.
 *
 * The ones worth reading twice are the inverses. An inverse is the only part of
 * an edit that no user exercises until something has already gone wrong, and a
 * wrong inverse fails in a way that LOOKS like it works — undo appears to run,
 * the layer panel updates, and the document is subtly not what it was. Several
 * mutations below are exactly the plausible-looking inverse a reviewer would
 * accept.
 */
export default {
  name: 'C — commands, history, store',
  testCommand: 'pnpm vitest run --project state --silent',
  mutations: [
    /* ---- the invoker -------------------------------------------------- */
    {
      // @vpb/core refuses by returning its input. Without this backstop a
      // command that forgot a precondition reports success, history takes an
      // entry whose undo does nothing, and the user presses Ctrl+Z twice --
      // losing a real edit to a no-op entry.
      name: 'invoker no longer rejects a command that changed nothing',
      file: 'packages/state/src/command.ts',
      find: '  if (outcome.state.project === state.project) {',
      replace: '  if (false) {',
    },

    /* ---- structural inverses ------------------------------------------ */
    {
      // THE PLAUSIBLE-LOOKING INVERSE. moveNode's index is a position as the
      // user sees it BEFORE the move; the old index is where the node must END
      // UP. They agree for reparents and differ for same-parent reorders, so
      // this passes every test written from the happy path.
      name: 'move inverted with the old index instead of a final position',
      file: 'packages/state/src/commands/nodeCommands.ts',
      find: '      const next = withTree(state, moveNode(tree, id, newParentId, index));\n      return succeed(next, restoreNodePositionCommand(id, oldParentId, oldIndex));',
      replace:
        '      const next = withTree(state, moveNode(tree, id, newParentId, index));\n      return succeed(next, moveNodeCommand(id, oldParentId, oldIndex));',
    },
    {
      // The same off-by-one from the other side: moveNode decrements a
      // same-parent later move, so landing on an exact index means asking for
      // one past it.
      name: 'final-index conversion drops the same-parent adjustment',
      file: 'packages/state/src/commands/nodeCommands.ts',
      find: '  return finalIndex >= currentIndex ? finalIndex + 1 : finalIndex;',
      replace: '  return finalIndex;',
    },
    {
      // A delete that captures only the node orphans its descendants: undo puts
      // back a node whose children exist in no `nodes` map.
      name: 'delete captures only the node, not its subtree',
      file: 'packages/state/src/commands/nodeCommands.ts',
      find: '      const removedIds = subtreeIds(tree, id);',
      replace: '      const removedIds = [id];',
    },
    {
      // Data loss wearing an undo's clothes: the node comes back unstyled.
      name: 'delete does not restore node-scoped style rules on undo',
      file: 'packages/state/src/commands/nodeCommands.ts',
      find: '        insertSubtreeCommand(nodes, id, parentId, index, detached.rules),',
      replace: '        insertSubtreeCommand(nodes, id, parentId, index),',
    },
    {
      name: 'insert no longer selects the node it created',
      file: 'packages/state/src/commands/nodeCommands.ts',
      find: '      return succeed(select(next, [node.id]), removeNodeCommand(node.id));',
      replace: '      return succeed(next, removeNodeCommand(node.id));',
    },

    /* ---- class order is cascade order --------------------------------- */
    {
      // THE BUG THIS INVERSE EXISTS FOR. resolve.ts orders scopes as
      // classes.map(classScope), weakest first -- so re-adding a removed class
      // appends it at the STRONGEST position and a property it used to lose, it
      // now wins. The layer panel looks right; the page renders differently.
      name: 'removed class re-added at the end instead of its position',
      file: 'packages/state/src/commands/propCommands.ts',
      find: '        updateNodeBy(tree, id, (current) => removeClass(current, name)),\n      );\n      return succeed(next, setNodeClassesCommand(id, previous));',
      replace:
        '        updateNodeBy(tree, id, (current) => removeClass(current, name)),\n      );\n      return succeed(next, addClassCommand(id, name));',
    },
    {
      name: 'class list comparison ignores order, so a reorder is a no-op',
      file: 'packages/state/src/commands/propCommands.ts',
      find: '  return a.length === b.length && a.every((name, i) => name === b[i]);',
      replace: '  return a.length === b.length && a.every((name) => b.includes(name));',
    },

    /* ---- prop validation ---------------------------------------------- */
    {
      // The registry decides what a component's props are. Without this a typo
      // writes a prop no renderer reads and no panel shows.
      name: 'setNodeProp accepts a prop the component does not declare',
      file: 'packages/state/src/commands/propCommands.ts',
      find: '      if (!definition) return refuse(`${component.label} has no prop "${name}".`);',
      replace: '      if (!definition) return succeed(state, renameNodeCommand(id, node.name));',
    },
    {
      name: 'setNodeProp accepts a value of the wrong kind',
      file: 'packages/state/src/commands/propCommands.ts',
      find: '      if (!acceptsPropValue(definition, value)) {',
      replace: '      if (false) {',
    },
    {
      name: 'rename no longer refuses a no-op',
      file: 'packages/state/src/commands/propCommands.ts',
      find: "      if ((name?.trim() || undefined) === previous) return refuse('The name is unchanged.');",
      replace: '',
    },

    /* ---- style commands ----------------------------------------------- */
    {
      name: 'style command accepts a value the property rejects',
      file: 'packages/state/src/commands/styleCommands.ts',
      find: '      if (!acceptsValue(property, value)) {',
      replace: '      if (false) {',
    },
    {
      // A coalesce key that ignores the breakpoint merges a desktop edit with a
      // mobile edit: one undo, two breakpoints, and the user cannot get either
      // back on its own.
      name: 'coalesce key ignores the target, merging across breakpoints',
      file: 'packages/state/src/commands/styleCommands.ts',
      find: '  return `setStyleProperty:${scopeKey(scope)}:${targetKey(target)}:${property}`;',
      replace: '  return `setStyleProperty:${scopeKey(scope)}:${property}`;',
    },
    {
      // Undoing a clear must put back the rule that was there, not a lookalike
      // with a new identity.
      name: 'unset restores the rule under a fresh id instead of its own',
      file: 'packages/state/src/commands/styleCommands.ts',
      find: '      return succeed(next, setStylePropertyCommand(scope, target, property, previous, existing.id));',
      replace:
        "      return succeed(next, setStylePropertyCommand(scope, target, property, previous, 'mutant' as StyleRuleId));",
    },

    /* ---- history: the four AUDIT §4.3 defects -------------------------- */
    {
      // "Unlimited undo" = unbounded memory growth.
      name: 'history stack is uncapped',
      file: 'packages/state/src/history.ts',
      find: '  const capped = past.length > history.limit ? past.slice(past.length - history.limit) : past;',
      replace: '  const capped = past;',
    },
    {
      // Keeping the redo branch after a new edit lets a later redo replay a
      // command against a document it was never computed for.
      name: 'a new edit does not clear the redo branch',
      file: 'packages/state/src/history.ts',
      find: '  return { ...history, past: capped, future: [] };',
      replace: '  return { ...history, past: capped, future: history.future };',
    },
    {
      name: 'coalescing ignores the time window — a pause is no longer a boundary',
      file: 'packages/state/src/history.ts',
      find: '  return next.at - previous.at <= windowMs;',
      replace: '  return true;',
    },
    {
      name: 'coalescing ignores the key, merging unrelated edits',
      file: 'packages/state/src/history.ts',
      find: '  if (previous.coalesceKey !== next.coalesceKey) return false;',
      replace: '',
    },
    {
      name: 'coalescing merges structural edits, which carry no key',
      file: 'packages/state/src/history.ts',
      find: '  if (previous.coalesceKey === undefined || next.coalesceKey === undefined) return false;',
      replace: '',
    },
    {
      // A merged entry that keeps the LAST undo rewinds one keystroke and calls
      // the whole run undone.
      name: 'merged entry undoes to the last edit, not the first',
      file: 'packages/state/src/history.ts',
      find: '    undo: previous.undo,',
      replace: '    undo: next.undo,',
    },
    {
      // AUDIT §4.3's actual complaint, inverted: an undo that leaves the wrong
      // node selected retargets the user's next edit.
      name: 'undo does not restore the context the edit happened in',
      file: 'packages/state/src/history.ts',
      find: '    state: { ...outcome.state, context: entry.contextBefore },',
      replace: '    state: outcome.state,',
    },
    {
      // Commands act on the ACTIVE page. Undoing while the user is looking at
      // another page applies the inverse to the wrong tree.
      name: 'undo runs the inverse against whatever page is being viewed',
      file: 'packages/state/src/history.ts',
      find: '  const at: EditorState = { ...state, context: entry.contextAfter };\n  const outcome = applyCommand(at, entry.undo, env);',
      replace: '  const outcome = applyCommand(state, entry.undo, env);',
    },

    /* ---- the store: transient vs committed ----------------------------- */
    {
      // Previewing against the previous preview instead of the committed state
      // stacks a drag: sixty frames become sixty applied edits, and the last
      // one wins only by accident.
      name: 'preview applies to the previous preview instead of committed',
      file: 'packages/state/src/store.ts',
      find: '      preview(command) {\n        const { committed } = get();',
      replace: '      preview(command) {\n        const committed = get().present;',
    },
  ],
};
