import type { ComponentRegistry } from '@vpb/core';

import type { EditorState } from './editorState.ts';

/**
 * Non-document dependencies a command needs at apply time.
 *
 * The registry is NOT in `EditorState`, deliberately. It is not document data —
 * it is assembled at startup from the builtins plus whatever plugins Phase K
 * loads, and it is not in the `.vpb` file. Putting it in the state would hand it
 * to history, so undo would roll back a plugin registration; putting it in the
 * `Project` would persist a plugin's components into a file that cannot
 * reconstruct them.
 *
 * Passed to `apply` rather than captured at construction so a command cannot go
 * stale against a registry that changed after it was built.
 *
 * NOTE what is deliberately absent: `IdFactory`. Minting at apply time would give
 * a redone command different ids than the original, orphaning the node-scoped
 * style rules and selection that referenced the first set. Commands that create
 * nodes take them pre-minted; see `insertNodeCommand`.
 */
export interface EditorEnvironment {
  readonly registry: ComponentRegistry;
}

/**
 * THE COMMAND CONTRACT.
 *
 * AUDIT §7.3: the prototype's `commands.ts` "contains pure tree helpers, not
 * commands. No `Command` interface, no invoker, no inverse ops, no
 * transaction/batching — which is why history must snapshot (§4.3)." Every
 * clause of that sentence is a requirement here, and the last one is the load
 * bearing part: **history can only stop snapshotting if edits know how to undo
 * themselves.**
 *
 * So a command does two things at once: it produces the next state, and it
 * produces the command that puts the state back. `apply` is where both happen,
 * because the inverse usually needs information that exists only *before* the
 * edit — the node that is about to be deleted, the value about to be
 * overwritten — and that information is gone by the time undo is pressed.
 *
 * WHY INVERSES AND NOT IMMER PATCHES. AUDIT §4.3 asks for "patch-based history
 * (immer patches / inverse commands)" and either satisfies it. Inverses win here
 * on three counts: core's ~30 mutators are pure functions returning new objects,
 * and immer can only generate fine-grained patches by *mutating a draft*, so
 * patches would mean rewriting the one part of this codebase that is proven;
 * wrapping the pure functions in `produce` instead yields a single coarse
 * `replace /pages/0/tree` patch carrying a whole new tree, which is a snapshot
 * wearing a patch's clothes; and an inverse is smaller anyway — undoing an insert
 * stores one `NodeId` where the patch stores the replaced Map. Phase L is
 * CRDT-native Yjs, which consumes its own types, so patches buy nothing there
 * either.
 */
export interface Command {
  /** Stable machine name. For telemetry, tests, and coalescing. */
  readonly kind: string;
  /**
   * Human-readable, imperative: shown as "Undo Move Box" in a menu. Computed at
   * construction while the operands are in hand — after the edit, the node it
   * names may not exist.
   */
  readonly label: string;
  /**
   * Consecutive commands sharing a key merge into ONE history entry.
   *
   * AUDIT §4.3: `updateCss` called `commit` on every character typed, so undo
   * rewound one keystroke at a time through a full document snapshot each. A key
   * must identify the *thing being edited* — the property on the target, not the
   * value — so that dragging one slider coalesces while moving to the next
   * slider does not. `undefined` means never merge; structural edits set nothing.
   */
  readonly coalesceKey?: string;
  apply(state: EditorState, env: EditorEnvironment): CommandOutcome;
}

export interface CommandSuccess {
  readonly ok: true;
  readonly state: EditorState;
  /** Applying this to `state` returns the state `apply` was given. */
  readonly inverse: Command;
}

/**
 * A refusal is a normal outcome, not an error.
 *
 * Dropping a section into its own child, inserting a `text` into an `image`,
 * deleting the root — these are things a UI will ask for constantly (a drag
 * passes over illegal targets on its way to a legal one) and they are not
 * exceptional. They carry a reason so the canvas can say why rather than
 * appearing to ignore the gesture.
 */
export interface CommandRefusal {
  readonly ok: false;
  readonly reason: string;
}

export type CommandOutcome = CommandSuccess | CommandRefusal;

export function refuse(reason: string): CommandRefusal {
  return { ok: false, reason };
}

export function succeed(state: EditorState, inverse: Command): CommandSuccess {
  return { ok: true, state, inverse };
}

/**
 * THE INVOKER. Run a command; reject an edit that edited nothing.
 *
 * The backstop exists because of a convention in `@vpb/core`: its mutators
 * refuse by returning **the object they were given** — `insertNode` on a
 * duplicate id, `moveNode` into a descendant, `updateNode` on an unknown id all
 * hand back the same tree. That is right for the model layer (it keeps every
 * function total and composable) and quietly wrong at this one: a command that
 * forgot to check its preconditions would report success, and history would take
 * an entry whose undo does nothing. The user presses Ctrl+Z, watches nothing
 * happen, and presses it again — losing a real edit.
 *
 * Reference equality is the exact test. Core returns a NEW object whenever it
 * changes anything, so `next.project === prev.project` means nothing happened,
 * with no false positives to reason about.
 *
 * Commands still check their own preconditions and refuse with a specific reason;
 * this catches the one that forgets. Reaching it is a bug in the command, so it
 * names the command rather than pretending to be a domain refusal.
 */
export function applyCommand(
  state: EditorState,
  command: Command,
  env: EditorEnvironment,
): CommandOutcome {
  const outcome = command.apply(state, env);
  if (!outcome.ok) return outcome;

  if (outcome.state.project === state.project) {
    return refuse(
      `${command.kind} reported success but changed nothing. ` +
        'The command is missing a precondition check — @vpb/core refuses by returning its input.',
    );
  }
  return outcome;
}
