/**
 * PHASE E4 — batching and the multi-node ops built on it.
 *
 * `batchCommand` is the answer to AUDIT §7.3's "no transaction/batching": several
 * commands, one history entry, one combined inverse. Its bugs are the ones a
 * single-command test cannot see — a batch that applies only part of itself, an
 * inverse that undoes in the wrong order, a refusal that leaves half the edit
 * behind. Runs against the `state` project alone; every `find` is a single line.
 */
export default {
  name: 'E4 — batching + multi-node commands',
  testCommand: 'pnpm vitest run --project state --silent',
  mutations: [
    /* ---- batchCommand -------------------------------------------------- */
    {
      // A batch that stops after its first part is a transaction in name only:
      // "delete 3 nodes" deletes one and reports success.
      name: 'the batch applies only its first command',
      file: 'packages/state/src/commands/batch.ts',
      find: '        inverses.push(outcome.inverse);',
      replace: '        inverses.push(outcome.inverse);\n        break;',
    },
    {
      // THE load-bearing property. Removing a@0 then b@0 only undoes to [a,b] if
      // the inverses run backwards; forward order restores them to wrong slots.
      name: 'the combined inverse runs forward instead of reversed',
      file: 'packages/state/src/commands/batch.ts',
      find: '      return succeed(current, batchCommand(label, [...inverses].reverse()));',
      replace: '      return succeed(current, batchCommand(label, [...inverses]));',
    },
    {
      // Atomicity gone: a refused part is skipped and the rest still applies, so a
      // half-finished multi-delete reaches history.
      name: 'a refused part no longer aborts the batch',
      file: 'packages/state/src/commands/batch.ts',
      find: '        if (!outcome.ok) return refuse(`${label} was refused: ${outcome.reason}`);',
      replace: '        if (!outcome.ok) continue;',
    },
    {
      // An empty batch that succeeds is an entry whose undo does nothing — the
      // invisible Ctrl+Z the command layer exists to prevent.
      name: 'an empty batch is accepted',
      file: 'packages/state/src/commands/batch.ts',
      find: "        return refuse('A batch must contain at least one command.');",
      replace: '        return succeed(state, batchCommand(label, []));',
    },

    /* ---- removeNodesCommand -------------------------------------------- */
    {
      // Without the topmost filter, selecting a container AND its child asks to
      // remove the child twice; the second refuses and atomicity sinks the delete.
      name: 'the topmost filter is dropped, so a container and its child collide',
      file: 'packages/state/src/commands/nodeCommands.ts',
      find: '      const targets = topmostNodes(tree, ids);',
      replace: '      const targets = [...new Set(ids)];',
    },

    /* ---- reorderNodesCommand ------------------------------------------- */
    {
      // A RELATIVE command must never coalesce: `merge` takes the later redo
      // wholesale, so two merged "move later" steps redo as one and land wrong.
      name: 'the relative reorder is given a coalesce key',
      file: 'packages/state/src/commands/nodeCommands.ts',
      find: "    kind: 'reorderNodes',",
      replace: "    kind: 'reorderNodes',\n    coalesceKey: 'reorder',",
    },
    {
      // At the boundary `moveNode` clamps but still returns a NEW tree, so without
      // this guard a node already first reports success having changed nothing.
      name: 'the first-sibling boundary guard is removed',
      file: 'packages/state/src/commands/nodeCommands.ts',
      find: "        if (direction < 0 && index === 0) return refuse('Already first among its siblings.');",
      replace: "        if (false) return refuse('Already first among its siblings.');",
    },
    {
      // Earlier and later swap: Left moves the node right.
      name: 'the reorder direction is inverted',
      file: 'packages/state/src/commands/nodeCommands.ts',
      find: '        moveNodeCommand(id, parentId, preMoveIndexFor(tree, id, parentId, index + direction)),',
      replace:
        '        moveNodeCommand(id, parentId, preMoveIndexFor(tree, id, parentId, index - direction)),',
    },
    {
      // Moving several nodes later must walk back-to-front, or a node lands on the
      // slot another selected node is about to vacate.
      name: 'the reorder processes both directions front-to-back',
      file: 'packages/state/src/commands/nodeCommands.ts',
      find: '      moves.sort((a, b) => (direction < 0 ? a.index - b.index : b.index - a.index));',
      replace: '      moves.sort((a, b) => a.index - b.index);',
    },
  ],
};
