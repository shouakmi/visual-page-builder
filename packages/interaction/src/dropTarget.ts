import type { NodeId } from '@vpb/core';

/**
 * WHERE A DRAG WOULD DROP — pure geometry, no DOM.
 *
 * This is the brain of structural drag, kept headless for the same reason
 * `@vpb/core` is: the decision is arithmetic on rectangles, and arithmetic is
 * testable without a browser jsdom cannot lay out anyway. The app measures the
 * elements (`getBoundingClientRect`) and hands the numbers here; the answer goes
 * to `moveNodeCommand`, and core does the actual move and its validity checks.
 *
 * AUDIT §4.1: the prototype's "drag" only ever set `left/top` and never computed a
 * drop position at all. Everything a real drop needs — which parent, which gap —
 * lives in this one function.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A `getBoundingClientRect`-shaped rectangle. Viewport coordinates; only the relative order matters here. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Vertical stacks (block flow, `flex-direction: column`) vs horizontal rows. */
export type DropAxis = 'vertical' | 'horizontal';

export interface DropChild {
  readonly id: NodeId;
  readonly rect: Rect;
}

export interface DropZone {
  /** The container the drop is being considered inside. */
  readonly parentId: NodeId;
  /**
   * The container's children AS THEY ARE NOW, in document order — INCLUDING the
   * dragged node when it already lives here.
   *
   * That inclusion is not an accident: `moveNode`'s `index` is a position in the
   * children list before the node is removed, and it decrements a same-parent
   * move itself. Feed it an index computed against a list the dragged node was
   * cut from and every same-parent reorder lands one slot off. So the caller
   * passes the real, current children and lets core do the shift.
   */
  readonly children: readonly DropChild[];
  readonly axis: DropAxis;
}

export interface Drop {
  readonly parentId: NodeId;
  /** Position in `parentId.children` as it looks now — exactly what `moveNode` expects. */
  readonly index: number;
}

/**
 * The index the dragged node should take in `zone`, from the pointer position.
 *
 * A child sits "before" the pointer when the pointer is past its MIDPOINT along
 * the stack axis — the midpoint, not an edge, so the gap flips at the natural
 * halfway line and a drop never feels like it lands a row early or late. The
 * result is the count of children before the pointer: 0 to prepend, `length` to
 * append (pointer past every midpoint), and the gap index in between.
 */
export function dropTarget(pointer: Point, zone: DropZone): Drop {
  const along = zone.axis === 'vertical' ? pointer.y : pointer.x;

  let index = 0;
  for (const child of zone.children) {
    if (midpoint(child.rect, zone.axis) < along) index += 1;
  }

  return { parentId: zone.parentId, index };
}

function midpoint(rect: Rect, axis: DropAxis): number {
  return axis === 'vertical' ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
}
