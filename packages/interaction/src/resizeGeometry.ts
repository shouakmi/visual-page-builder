import type { Point } from './dropTarget.ts';

/**
 * HOW BIG A RESIZE WOULD MAKE THE BOX — pure geometry, no DOM.
 *
 * The sibling of `dropTarget`: structural drag decides WHERE, resize decides HOW
 * BIG, and both are arithmetic on rectangles kept out of the browser for the same
 * reason. The app measures the element's start size (`getBoundingClientRect`) and
 * the pointer's travel and hands the numbers here; the answer becomes width/height
 * on the active breakpoint through `setStylePropertiesCommand`.
 *
 * v1 changes width and height only. A handle on the north or west edge visibly
 * moves the box's top-left, but in flow layout that origin is layout-determined —
 * the model has no `left`/`top` to write — so every handle here resolves to a size,
 * not a position. Absolute-position resize (moving the origin) is a later
 * refinement, exactly as into-container drops were for E2.
 */

/** The eight handles, named by compass point. Corners drive two axes, edges one. */
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface ResizeConstraints {
  /** A box never resizes below this — a zero-size element is unselectable and unclickable. */
  readonly minWidth: number;
  readonly minHeight: number;
  /**
   * `width / height` to preserve (the Shift key). Absent means a free resize.
   * The ratio is locked to the axis the handle actually drives: a side handle
   * drives its one axis and derives the other; a corner drives width and derives
   * height from it, so the gesture stays deterministic rather than chasing
   * whichever delta happens to be larger.
   */
  readonly aspectRatio?: number;
}

/**
 * Which direction each handle grows in. `+1` means the edge follows the pointer
 * along the positive axis (east grows width as the pointer moves right, south
 * grows height as it moves down); `-1` means it grows as the pointer moves the
 * other way (west, north); `0` means the handle does not touch that axis.
 */
const HORIZONTAL: Record<ResizeHandle, -1 | 0 | 1> = {
  n: 0,
  s: 0,
  e: 1,
  w: -1,
  ne: 1,
  nw: -1,
  se: 1,
  sw: -1,
};

const VERTICAL: Record<ResizeHandle, -1 | 0 | 1> = {
  n: -1,
  s: 1,
  e: 0,
  w: 0,
  ne: -1,
  nw: -1,
  se: 1,
  sw: 1,
};

/**
 * The size the box should take, from its start size and the pointer's travel.
 *
 * `delta` is the pointer's movement since the gesture began. The signed factors
 * turn "pointer moved right/down" into "this edge grew or shrank"; the aspect lock
 * ties the two axes when asked; the min clamp is last, so a box can be dragged
 * small but never past the floor that keeps it selectable.
 */
export function resizeSize(
  start: Size,
  handle: ResizeHandle,
  delta: Point,
  constraints: ResizeConstraints,
): Size {
  const hx = HORIZONTAL[handle];
  const vy = VERTICAL[handle];

  let width = start.width + hx * delta.x;
  let height = start.height + vy * delta.y;

  if (constraints.aspectRatio !== undefined) {
    if (hx !== 0) height = width / constraints.aspectRatio;
    else if (vy !== 0) width = height * constraints.aspectRatio;
  }

  return {
    width: Math.max(width, constraints.minWidth),
    height: Math.max(height, constraints.minHeight),
  };
}
