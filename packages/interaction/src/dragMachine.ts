import type { NodeId } from '@vpb/core';

import type { Drop, Point } from './dropTarget.ts';

/**
 * THE DRAG STATE MACHINE — a pointer drag as a pure transition function.
 *
 * The whole point of this file is that it has no DOM and no store in it. A drag is
 * a sequence — press, cross a threshold, move, release or escape — and that
 * sequence is where the bugs live: firing a move before the drag has really begun,
 * committing a click as if it were a drag, forgetting to revert on Escape. Modelled
 * as `(state, input) -> {state, intent}` it is testable as arithmetic, and the
 * host is left with nothing but "do what the intent says".
 *
 * `input.drop` is resolved by the caller (the DOM adapter measures the page and
 * calls `dropTarget`); the machine never looks at an element. The `intent` names a
 * store action — `preview`, `commit`, `cancel` — that the host performs. So both
 * the decision (here) and the store integration (the host's `applyDragIntent`) are
 * testable without a browser; only the measuring in between is not.
 */

export type DragState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'pending'; readonly nodeId: NodeId; readonly origin: Point }
  | { readonly phase: 'dragging'; readonly nodeId: NodeId; readonly origin: Point };

export type DragInput =
  | { readonly type: 'down'; readonly nodeId: NodeId; readonly point: Point }
  | { readonly type: 'move'; readonly point: Point; readonly drop: Drop | null }
  | { readonly type: 'up' }
  | { readonly type: 'cancel' };

/** What the host should do to the store. `nodeId` rides on `preview` so the host tracks nothing. */
export type DragIntent =
  | { readonly type: 'none' }
  | { readonly type: 'preview'; readonly nodeId: NodeId; readonly drop: Drop }
  | { readonly type: 'clearPreview' }
  | { readonly type: 'commit' }
  | { readonly type: 'cancel' };

export interface DragOptions {
  /** Pixels the pointer must travel before a press becomes a drag — so a click is not a one-pixel move. */
  readonly threshold: number;
}

export const IDLE: DragState = { phase: 'idle' };

export interface DragStep {
  readonly state: DragState;
  readonly intent: DragIntent;
}

/**
 * Advance the drag by one input.
 *
 * `pending` is the gap between press and drag: the node is armed but nothing has
 * moved in the document, so a plain click (press then release, no travel) leaves
 * through `up` with intent `none` and never touches history. Only once the pointer
 * has travelled past the threshold does the machine enter `dragging` and start
 * previewing. A `move` with no valid drop clears the preview (the node snaps back)
 * rather than leaving a stale one on screen.
 */
export function dragStep(state: DragState, input: DragInput, options: DragOptions): DragStep {
  switch (input.type) {
    case 'down':
      // Arm a potential drag from the pressed node. A press mid-drag abandons the
      // one in flight, reverting its preview.
      return {
        state: { phase: 'pending', nodeId: input.nodeId, origin: input.point },
        intent: state.phase === 'dragging' ? { type: 'cancel' } : { type: 'none' },
      };

    case 'move': {
      if (state.phase === 'idle') return { state, intent: { type: 'none' } };

      const crossed =
        state.phase === 'dragging' || distance(state.origin, input.point) >= options.threshold;
      if (!crossed) return { state, intent: { type: 'none' } };

      const dragging: DragState = { phase: 'dragging', nodeId: state.nodeId, origin: state.origin };
      return {
        state: dragging,
        intent: input.drop
          ? { type: 'preview', nodeId: state.nodeId, drop: input.drop }
          : { type: 'clearPreview' },
      };
    }

    case 'up':
      return {
        state: IDLE,
        intent: state.phase === 'dragging' ? { type: 'commit' } : { type: 'none' },
      };

    case 'cancel':
      return {
        state: IDLE,
        intent: state.phase === 'dragging' ? { type: 'cancel' } : { type: 'none' },
      };
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
