import type { NodeId } from '@vpb/core';

import type { Point } from './dropTarget.ts';
import { drivesHorizontally, resizeSize, type ResizeHandle, type Size } from './resizeGeometry.ts';
import { snapSize, type SnapCandidate, type SnapGuide, type SnapResult } from './snapGuides.ts';

/**
 * THE RESIZE STATE MACHINE — a pointer resize as a pure transition function.
 *
 * The sibling of `dragMachine`, and the same discipline: no DOM, no store. A
 * resize is a sequence — grab a handle, cross a threshold, move, release or
 * escape — and the sequence is where the bugs live: previewing before the gesture
 * has really begun, committing a click on a handle as a zero-size edit, forgetting
 * to revert on Escape. Modelled as `(state, input) -> {state, intent}` it is
 * testable as arithmetic.
 *
 * Unlike drag, the size math needs no DOM — `resizeSize` is pure — so the machine
 * owns it: the host measures the start size once at `down` and thereafter only
 * feeds pointer positions. The `intent` names a store action the host performs, so
 * both the decision (here) and the store integration (the controller) are testable
 * without a browser; only the one `getBoundingClientRect` at grab time is not.
 */

export type ResizeState =
  | { readonly phase: 'idle' }
  | {
      readonly phase: 'pending';
      readonly nodeId: NodeId;
      readonly handle: ResizeHandle;
      readonly start: Size;
      readonly origin: Point;
    }
  | {
      readonly phase: 'resizing';
      readonly nodeId: NodeId;
      readonly handle: ResizeHandle;
      readonly start: Size;
      readonly origin: Point;
    };

export type ResizeInput =
  | {
      readonly type: 'down';
      readonly nodeId: NodeId;
      readonly handle: ResizeHandle;
      /** The element's size at grab time, measured by the host. */
      readonly start: Size;
      readonly point: Point;
    }
  | {
      readonly type: 'move';
      readonly point: Point;
      readonly aspect: boolean;
      /**
       * The alignment lines available right now, measured by the host. Absent
       * means no snapping, which is exactly the pre-E5 behaviour.
       */
      readonly snap?: SnapInput;
    }
  | { readonly type: 'up' }
  | { readonly type: 'cancel' };

/**
 * What the box could align to, measured fresh on every move.
 *
 * Fresh, not captured at grab time: resizing a box reflows the page around it, so
 * both its own origin and its neighbours' positions can move mid-gesture. Reading
 * them once at `down` would snap to where things used to be.
 */
export interface SnapInput {
  /** The resized box's top-left, in the same coordinates the candidates were measured in. */
  readonly boxOrigin: Point;
  readonly candidates: readonly SnapCandidate[];
}

/** What the host should do to the store. `nodeId` rides on `preview` so the host tracks nothing. */
export type ResizeIntent =
  | { readonly type: 'none' }
  | {
      readonly type: 'preview';
      readonly nodeId: NodeId;
      readonly size: Size;
      /** The lines the size landed on. Empty when nothing snapped — a guide is never drawn on speculation. */
      readonly guides: readonly SnapGuide[];
    }
  | { readonly type: 'commit' }
  | { readonly type: 'cancel' };

export interface ResizeOptions {
  /** Pixels the pointer must travel before a grab becomes a resize — so a click on a handle is not a 1px edit. */
  readonly threshold: number;
  readonly minWidth: number;
  readonly minHeight: number;
  /** On-screen pixels within which an edge snaps to an alignment line. Default 5. */
  readonly snapThreshold?: number;
}

/** Close enough to feel magnetic, far enough that a deliberate size is still reachable. */
const DEFAULT_SNAP_THRESHOLD = 5;

export const RESIZE_IDLE: ResizeState = { phase: 'idle' };

export interface ResizeStep {
  readonly state: ResizeState;
  readonly intent: ResizeIntent;
}

/**
 * Advance the resize by one input.
 *
 * `pending` is the gap between grab and resize: the handle is armed but no size
 * has changed, so a plain click on a handle (grab then release, no travel) leaves
 * through `up` with intent `none` and never touches history. Only once the pointer
 * has travelled past the threshold does the machine enter `resizing` and preview.
 * A resize always has a valid size — there is no "over nothing" case as drag has —
 * so a move while resizing always previews.
 */
export function resizeStep(
  state: ResizeState,
  input: ResizeInput,
  options: ResizeOptions,
): ResizeStep {
  switch (input.type) {
    case 'down':
      // Arm a potential resize from the grabbed handle. A grab mid-resize abandons
      // the one in flight, reverting its preview.
      return {
        state: {
          phase: 'pending',
          nodeId: input.nodeId,
          handle: input.handle,
          start: input.start,
          origin: input.point,
        },
        intent: state.phase === 'resizing' ? { type: 'cancel' } : { type: 'none' },
      };

    case 'move': {
      if (state.phase === 'idle') return { state, intent: { type: 'none' } };

      const crossed =
        state.phase === 'resizing' || distance(state.origin, input.point) >= options.threshold;
      if (!crossed) return { state, intent: { type: 'none' } };

      const resizing: ResizeState = {
        phase: 'resizing',
        nodeId: state.nodeId,
        handle: state.handle,
        start: state.start,
        origin: state.origin,
      };
      // Guard the degenerate box: a zero-height start has no ratio to lock to. The
      // ratio is spread in only when present — under `exactOptionalPropertyTypes` an
      // explicit `aspectRatio: undefined` is not the same as an absent one.
      const aspectRatio =
        input.aspect && state.start.height > 0 ? state.start.width / state.start.height : undefined;
      const size = resizeSize(
        state.start,
        state.handle,
        { x: input.point.x - state.origin.x, y: input.point.y - state.origin.y },
        {
          minWidth: options.minWidth,
          minHeight: options.minHeight,
          ...(aspectRatio !== undefined ? { aspectRatio } : {}),
        },
      );

      // Snap after the size math, clamp after the snap. An alignment line can sit
      // below the floor, and the floor is what keeps a box selectable at all, so it
      // gets the last word — a snap may never be the thing that shrinks a box away.
      const snapped = applySnap(size, input.snap, aspectRatio, state.handle, options);
      const clamped: Size = {
        width: Math.max(snapped.size.width, options.minWidth),
        height: Math.max(snapped.size.height, options.minHeight),
      };

      // A guide claims "this edge is on that line", so it survives only where the
      // edge really landed there. Where the floor overrode the snap, the box is not
      // on the line and drawing one anyway would be the overlay telling a lie.
      const heldWidth = clamped.width === snapped.size.width;
      const heldHeight = clamped.height === snapped.size.height;
      const guides = snapped.guides.filter((guide) =>
        guide.axis === 'x' ? heldWidth : heldHeight,
      );

      return {
        state: resizing,
        intent: { type: 'preview', nodeId: state.nodeId, size: clamped, guides },
      };
    }

    case 'up':
      return {
        state: RESIZE_IDLE,
        intent: state.phase === 'resizing' ? { type: 'commit' } : { type: 'none' },
      };

    case 'cancel':
      return {
        state: RESIZE_IDLE,
        intent: state.phase === 'resizing' ? { type: 'cancel' } : { type: 'none' },
      };
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Snapping, when the host offered anything to snap to.
 *
 * Under an aspect lock the ratio is handed through along with the axis the handle
 * drives, and `snapSize` then confines itself to that axis so the ratio survives
 * untouched. The aspect modifier therefore keeps its single meaning — preserve the
 * ratio — and never doubles as a "disable snapping" key; snapping simply declines
 * the moves where the two cannot both be honoured.
 */
function applySnap(
  size: Size,
  snap: SnapInput | undefined,
  aspectRatio: number | undefined,
  handle: ResizeHandle,
  options: ResizeOptions,
): SnapResult {
  if (!snap || snap.candidates.length === 0) return { size, guides: [] };

  return snapSize(snap.boxOrigin, size, snap.candidates, {
    threshold: options.snapThreshold ?? DEFAULT_SNAP_THRESHOLD,
    ...(aspectRatio !== undefined
      ? { aspectRatio, driven: drivesHorizontally(handle) ? ('x' as const) : ('y' as const) }
      : {}),
  });
}
