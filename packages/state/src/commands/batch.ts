import type { Command } from '../command.ts';
import { applyCommand, refuse, succeed } from '../command.ts';
import type { EditorState } from '../editorState.ts';

/**
 * THE TRANSACTION — several commands, ONE history entry.
 *
 * AUDIT §7.3 lists "no transaction/batching" among the prototype's defects, and it
 * is the last clause of that sentence Phase C left unanswered. The answer needs no
 * new history machinery, because **a transaction in an inverse-command history IS a
 * composite with a combined inverse**: run the parts in order, keep each part's
 * inverse, and undo by running those inverses BACKWARDS.
 *
 * Three properties make it safe to put in front of the history:
 *
 * - **Atomic.** If any part refuses, the whole batch refuses and returns no state.
 *   State is threaded functionally (each `apply` returns a new `EditorState`), so
 *   abandoning the accumulated value is all it takes — nothing partial can reach
 *   history, and a half-applied delete can never be committed.
 * - **The inverse runs in REVERSE.** Deleting siblings a@0 then b@0 (b shifted when
 *   a went) must undo as insert-b@0 then insert-a@0 to land back on [a, b]. Forward
 *   order restores the same nodes to the wrong places — invisible for a single
 *   command and wrong for exactly the multi-node case this exists to serve.
 * - **Parts go through `applyCommand`, not `apply`.** That keeps the invoker's
 *   backstop per part: a sub-command that reports success while changing nothing is
 *   caught here rather than becoming a silent no-op inside a bigger entry.
 *
 * An EMPTY batch refuses. Succeeding would produce an entry whose undo does
 * nothing — the invisible Ctrl+Z the whole command layer is built to prevent.
 *
 * No `coalesceKey`: structural edits never merge, and two deletes in a row are two
 * intentions. A RELATIVE command must never carry one either (see `history.ts`'s
 * `merge` — coalescing takes the later `redo` wholesale, which is only valid for
 * commands that assign rather than adjust), which is why the reorder built on this
 * sets none.
 */
export function batchCommand(label: string, commands: readonly Command[]): Command {
  return {
    kind: 'batch',
    label,
    apply(state, env) {
      if (commands.length === 0) {
        return refuse('A batch must contain at least one command.');
      }

      let current: EditorState = state;
      const inverses: Command[] = [];

      for (const command of commands) {
        const outcome = applyCommand(current, command, env);
        // Atomic: drop everything accumulated so far and report why.
        if (!outcome.ok) return refuse(`${label} was refused: ${outcome.reason}`);
        current = outcome.state;
        inverses.push(outcome.inverse);
      }

      return succeed(current, batchCommand(label, [...inverses].reverse()));
    },
  };
}
