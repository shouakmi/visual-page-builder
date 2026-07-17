import type { Command, EditorEnvironment } from './command.ts';
import { applyCommand } from './command.ts';
import type { EditorContext, EditorState } from './editorState.ts';

/**
 * UNDO/REDO.
 *
 * AUDIT §4.3 is the specification, stated as four defects:
 *
 *   1. "Each entry is a full deep EditorState with no cap" — unbounded memory
 *      growth, one whole-document clone per character typed.
 *   2. "One snapshot per keystroke": `updateCss` committed on every character.
 *   3. "Selection is committed to history": undo undid *clicks*, and breakpoint
 *      switches too. "Undo is destroyed as a feature."
 *   4. No transient/committed separation, so an in-progress drag was history.
 *
 * Each has a named answer here: entries hold two commands instead of a document
 * (§1, plus `limit`); `coalesceKey` merges a run of edits to one thing (§2);
 * context is RECORDED by an entry and never itself an entry (§3); and the store's
 * preview/commit pair keeps a drag out of history until it is over (§4).
 */

/**
 * One undoable edit.
 *
 * `undo` and `redo` are both commands, and `redo` is simply the command the user
 * originally ran. That works only because commands are deterministic — nothing
 * mints an id inside `apply` — so re-running one after an undo reproduces the
 * state it produced the first time, ids and all. If a command ever minted at
 * apply time, redo would silently build a different document.
 */
export interface HistoryEntry {
  readonly kind: string;
  readonly label: string;
  readonly coalesceKey?: string;
  /** Applying this to the post-edit state returns the pre-edit state. */
  readonly undo: Command;
  /** Applying this to the pre-edit state returns the post-edit state. */
  readonly redo: Command;
  /**
   * The context the edit happened in, restored on undo.
   *
   * This is the distinction AUDIT §4.3 turns on, and it is easy to read as the
   * same mistake: selection is RECORDED here, never COMMITTED. Clicking a
   * different node creates no entry — but undoing a delete puts the selection
   * back on the node it restores, because an undo that leaves the wrong node
   * selected silently retargets the user's next edit.
   */
  readonly contextBefore: EditorContext;
  /** The context the edit produced, restored on redo. */
  readonly contextAfter: EditorContext;
  /** Milliseconds, from an injected clock. Only ever compared, never displayed. */
  readonly at: number;
}

export interface History {
  /** Oldest first. The last element is what `undo` will run. */
  readonly past: readonly HistoryEntry[];
  /** The redo branch, most-recently-undone LAST. */
  readonly future: readonly HistoryEntry[];
  readonly limit: number;
  readonly coalesceWindowMs: number;
}

/**
 * 100 entries.
 *
 * "Unlimited undo" was the prototype's claim and its bug: unbounded full
 * snapshots (§4.3). Inverse commands are small enough that the cap is no longer
 * about the heap — a delete's inverse is the deleted subtree and everything else
 * is O(1) — but a cap is still correct, because the one expensive entry is
 * exactly the one a user can repeat all day.
 */
export const DEFAULT_HISTORY_LIMIT = 100;

/**
 * 500ms.
 *
 * Long enough that continuous typing stays one entry, short enough that pausing
 * to think starts a new one — which is where a user expects an undo boundary.
 */
export const DEFAULT_COALESCE_WINDOW_MS = 500;

export const EMPTY_HISTORY: History = {
  past: [],
  future: [],
  limit: DEFAULT_HISTORY_LIMIT,
  coalesceWindowMs: DEFAULT_COALESCE_WINDOW_MS,
};

export function createHistory(options: Partial<Omit<History, 'past' | 'future'>> = {}): History {
  return { ...EMPTY_HISTORY, ...options };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

/** What an Undo menu item should say, or `undefined` when there is nothing to undo. */
export function undoLabel(history: History): string | undefined {
  return history.past.at(-1)?.label;
}

export function redoLabel(history: History): string | undefined {
  return history.future.at(-1)?.label;
}

/**
 * Should these two merge into one entry?
 *
 * Both must name the same target and land inside the window. An absent key means
 * "never merge", which is why structural commands set none: two deletes in a row
 * are two intentions, where two keystrokes are one.
 */
function shouldCoalesce(previous: HistoryEntry, next: HistoryEntry, windowMs: number): boolean {
  if (previous.coalesceKey === undefined || next.coalesceKey === undefined) return false;
  if (previous.coalesceKey !== next.coalesceKey) return false;
  return next.at - previous.at <= windowMs;
}

/**
 * Merge a run of edits to one target into a single entry.
 *
 * The result undoes to before the FIRST edit and redoes to after the LAST: that
 * is what "one entry" has to mean, or undo lands somewhere the user never was.
 *
 * TAKING `next.redo` WHOLESALE IS ONLY VALID FOR ABSOLUTE COMMANDS. Redoing the
 * merged entry runs the last command against the pre-first state, which lands on
 * the final value precisely because `setStyleProperty` and friends *assign*
 * rather than adjust. A relative command ("nudge by 1px") would coalesce into a
 * redo that lands somewhere else entirely — so a relative command must never
 * carry a `coalesceKey`. There are none today; this is the rule if one is added.
 */
function merge(previous: HistoryEntry, next: HistoryEntry): HistoryEntry {
  return {
    ...next,
    undo: previous.undo,
    contextBefore: previous.contextBefore,
    at: next.at,
  };
}

/**
 * Add an edit to the timeline.
 *
 * Clears the redo branch: the user has moved off it, and keeping it would let a
 * later redo replay a command against a document it was never computed for.
 */
export function record(history: History, entry: HistoryEntry): History {
  const previous = history.past.at(-1);

  const past =
    previous && shouldCoalesce(previous, entry, history.coalesceWindowMs)
      ? [...history.past.slice(0, -1), merge(previous, entry)]
      : [...history.past, entry];

  // Drop from the front: the oldest edit is the one the user is least likely to
  // want back, and an uncapped stack is AUDIT §4.3's memory bug.
  const capped = past.length > history.limit ? past.slice(past.length - history.limit) : past;

  return { ...history, past: capped, future: [] };
}

export interface HistoryStep {
  readonly state: EditorState;
  readonly history: History;
}

/**
 * Undo the most recent edit, or `undefined` when there is nothing to undo.
 *
 * The context is restored BEFORE the command runs, not only after. Commands act
 * on the *active page*, so undoing while the user is looking at a different page
 * would otherwise apply the inverse to the wrong tree — silently editing a page
 * they are not even looking at. Restoring first puts us back on the page the edit
 * happened on; restoring again afterwards discards any selection the inverse
 * command made on its own, since the entry's record of the context outranks it.
 */
export function undo(
  state: EditorState,
  history: History,
  env: EditorEnvironment,
): HistoryStep | undefined {
  const entry = history.past.at(-1);
  if (!entry) return undefined;

  const at: EditorState = { ...state, context: entry.contextAfter };
  const outcome = applyCommand(at, entry.undo, env);
  if (!outcome.ok) {
    throw new Error(
      `Undo of "${entry.label}" was refused: ${outcome.reason}. ` +
        'A recorded inverse must always apply; the history and the document have diverged.',
    );
  }

  return {
    state: { ...outcome.state, context: entry.contextBefore },
    history: { ...history, past: history.past.slice(0, -1), future: [...history.future, entry] },
  };
}

/** Redo the most recently undone edit, or `undefined` when the branch is empty. */
export function redo(
  state: EditorState,
  history: History,
  env: EditorEnvironment,
): HistoryStep | undefined {
  const entry = history.future.at(-1);
  if (!entry) return undefined;

  const at: EditorState = { ...state, context: entry.contextBefore };
  const outcome = applyCommand(at, entry.redo, env);
  if (!outcome.ok) {
    throw new Error(
      `Redo of "${entry.label}" was refused: ${outcome.reason}. ` +
        'A command that applied once must apply again from the same state.',
    );
  }

  return {
    state: { ...outcome.state, context: entry.contextAfter },
    history: { ...history, past: [...history.past, entry], future: history.future.slice(0, -1) },
  };
}

/** Build an entry from a command and the states it moved between. */
export function entryFor(
  command: Command,
  before: EditorState,
  after: EditorState,
  inverse: Command,
  at: number,
): HistoryEntry {
  return {
    kind: command.kind,
    label: command.label,
    ...(command.coalesceKey === undefined ? {} : { coalesceKey: command.coalesceKey }),
    undo: inverse,
    redo: command,
    contextBefore: before.context,
    contextAfter: after.context,
    at,
  };
}
