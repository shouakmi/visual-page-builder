import type { Point, Rect } from './dropTarget.ts';
import type { Size } from './resizeGeometry.ts';

/**
 * WHERE A RESIZE SHOULD ALIGN — pure geometry, no DOM.
 *
 * The third sibling of `dropTarget` (where a drag lands) and `resizeSize` (how big
 * a resize gets): given the lines the neighbours offer, this decides whether the
 * box being resized should land ON one of them, and reports the guide to draw so
 * the user can see why it did.
 *
 * ## Only two edges can move, and that is the model's doing
 *
 * `resizeSize` writes width and height and nothing else, because in flow layout a
 * box's top-left is layout-determined — the model has no `left`/`top` to write. So
 * of the four edges, only the RIGHT and the BOTTOM actually move, whichever handle
 * is grabbed: dragging the west grip grows the width, and the browser still puts
 * the box's left edge where the layout says. Snapping therefore matches the box's
 * far edge (or its centre, which moves at half the rate) against the neighbours'
 * lines, and never its near edge. Inventing a near-edge snap would mean inventing
 * a positioning model, which is E5 quietly becoming absolute positioning.
 *
 * ## Distance is measured on screen, not in the model
 *
 * A candidate is "in range" when the GAP THE USER SEES is within the threshold —
 * the pixels between the box's line and the neighbour's. For a centre match the
 * resulting width change is twice that gap, which is correct and deliberate: the
 * centre moves half as fast as the edge, so closing a 3px centre gap costs 6px of
 * width. Thresholding the width change instead would make centre snapping fire at
 * half the visual distance of edge snapping, and feel broken for one of the two.
 */

/** Which coordinate a guide line is fixed on. `x` is a vertical line, `y` a horizontal one. */
export type SnapAxis = 'x' | 'y';

/** Whether a line is a neighbour's edge or its midline. Reported so the guide can style them apart. */
export type SnapKind = 'edge' | 'center';

/**
 * One line a resize may align to, in the same viewport coordinates the rects were
 * measured in.
 *
 * `from`/`to` are the SOURCE's span along the other axis — the neighbour's own
 * extent. The drawn guide unions that with the resized box's span, so the line
 * visibly connects the two things it claims are aligned rather than floating at
 * some arbitrary length.
 */
export interface SnapCandidate {
  readonly axis: SnapAxis;
  readonly position: number;
  readonly kind: SnapKind;
  readonly from: number;
  readonly to: number;
}

/** A candidate that won, ready to draw: `from`/`to` now span both boxes. */
export interface SnapGuide {
  readonly axis: SnapAxis;
  readonly position: number;
  readonly kind: SnapKind;
  readonly from: number;
  readonly to: number;
}

export interface SnapOptions {
  /** On-screen pixels within which a line captures the box's edge. */
  readonly threshold: number;
  /**
   * The locked `width / height`, when the user is holding the aspect modifier.
   *
   * Snapping does not turn off under the lock and the lock never bends: only the
   * axis the handle DRIVES may snap, and the other axis is then re-derived from
   * the ratio. A line that could only be reached by breaking the ratio is simply
   * not taken. So the modifier keeps its one meaning — preserve the aspect ratio —
   * and snapping remains a separate, independent behaviour that yields when the
   * two genuinely cannot both hold.
   */
  readonly aspectRatio?: number;
  /** The axis the grabbed handle drives. Only consulted under an aspect lock. */
  readonly driven?: SnapAxis;
}

export interface SnapResult {
  readonly size: Size;
  /** Empty when nothing snapped. A guide is drawn only where an edge actually moved onto a line. */
  readonly guides: readonly SnapGuide[];
}

/**
 * The lines a set of neighbouring rects offers: both edges and the midline, on
 * both axes.
 *
 * The caller decides whose rects these are — `snapTargets` in the app passes the
 * resized node's siblings and their shared parent, and excludes the resized node
 * itself, since a box that can snap to its own edge can never leave it.
 */
export function snapCandidates(rects: readonly Rect[]): readonly SnapCandidate[] {
  const candidates: SnapCandidate[] = [];

  for (const rect of rects) {
    const right = rect.left + rect.width;
    const bottom = rect.top + rect.height;

    // Vertical lines, spanning the source's height.
    candidates.push({ axis: 'x', position: rect.left, kind: 'edge', from: rect.top, to: bottom });
    candidates.push({
      axis: 'x',
      position: rect.left + rect.width / 2,
      kind: 'center',
      from: rect.top,
      to: bottom,
    });
    candidates.push({ axis: 'x', position: right, kind: 'edge', from: rect.top, to: bottom });

    // Horizontal lines, spanning the source's width.
    candidates.push({ axis: 'y', position: rect.top, kind: 'edge', from: rect.left, to: right });
    candidates.push({
      axis: 'y',
      position: rect.top + rect.height / 2,
      kind: 'center',
      from: rect.left,
      to: right,
    });
    candidates.push({ axis: 'y', position: bottom, kind: 'edge', from: rect.left, to: right });
  }

  return candidates;
}

/**
 * The size the resize should actually take, and the guides that explain it.
 *
 * `origin` is the box's top-left — measured fresh each move, because resizing a
 * box reflows the page around it and the origin is not ours to assume. `proposed`
 * is what `resizeSize` already decided; snapping only ever adjusts it, and only
 * towards a line that is already within a few pixels.
 *
 * The two axes are independent when the ratio is free: a resize can align its
 * right edge to one neighbour and its bottom to another, which is the whole point
 * of a corner drag. Under an aspect lock they cannot be independent, so only the
 * driven axis is considered — see `SnapOptions.aspectRatio`.
 */
export function snapSize(
  origin: Point,
  proposed: Size,
  candidates: readonly SnapCandidate[],
  options: SnapOptions,
): SnapResult {
  const ratio = options.aspectRatio;

  if (ratio !== undefined) {
    // Locked. The driven axis is the one the handle actually controls, matching
    // `resizeSize`'s own aspect branch; the other follows from the ratio, so the
    // ratio holds by construction and a snap can never be what breaks it.
    const axis = options.driven ?? 'x';
    const hit = nearest(origin, proposed, candidates, axis, options.threshold);
    if (!hit) return { size: proposed, guides: [] };

    const size: Size =
      axis === 'x'
        ? { width: hit.extent, height: ratio === 0 ? proposed.height : hit.extent / ratio }
        : { width: hit.extent * ratio, height: hit.extent };
    return { size, guides: [guideFor(hit.candidate, origin, size)] };
  }

  const x = nearest(origin, proposed, candidates, 'x', options.threshold);
  const y = nearest(origin, proposed, candidates, 'y', options.threshold);

  const size: Size = {
    width: x ? x.extent : proposed.width,
    height: y ? y.extent : proposed.height,
  };

  const guides: SnapGuide[] = [];
  if (x) guides.push(guideFor(x.candidate, origin, size));
  if (y) guides.push(guideFor(y.candidate, origin, size));

  return { size, guides };
}

interface Hit {
  readonly candidate: SnapCandidate;
  /** The box's new extent along the snapped axis — width for `x`, height for `y`. */
  readonly extent: number;
  readonly gap: number;
  /** Which of the box's own lines matched. Edges beat centres when the gaps tie. */
  readonly line: 'far' | 'center';
}

/**
 * The closest line within the threshold, or null.
 *
 * Both of the box's movable lines are matched against every candidate, so an edge
 * can align to a neighbour's midline and vice versa. Ties are broken so the result
 * cannot depend on the order the caller happened to collect rects in: the box's
 * far edge wins over its centre (the stronger visual cue, and the one the user is
 * dragging), and then the lower coordinate wins.
 */
function nearest(
  origin: Point,
  proposed: Size,
  candidates: readonly SnapCandidate[],
  axis: SnapAxis,
  threshold: number,
): Hit | null {
  const start = axis === 'x' ? origin.x : origin.y;
  const extent = axis === 'x' ? proposed.width : proposed.height;

  let best: Hit | null = null;

  for (const candidate of candidates) {
    if (candidate.axis !== axis) continue;

    // The far edge sits at `start + extent`, so landing on the line makes the
    // extent `position - start`. The centre sits at `start + extent / 2` and moves
    // half as fast, so it takes twice the change to close the same visible gap.
    const far = candidate.position - start;
    const centre = 2 * (candidate.position - start);

    for (const [line, next] of [
      ['far', far],
      ['center', centre],
    ] as const) {
      // A line the box could only reach by inverting itself is not a candidate;
      // the min clamp would swallow it anyway and the guide would be a lie.
      if (next <= 0) continue;

      const gap = Math.abs(candidate.position - (start + lineAt(line, extent)));
      if (gap > threshold) continue;
      if (best && !beats({ candidate, extent: next, gap, line }, best)) continue;
      best = { candidate, extent: next, gap, line };
    }
  }

  return best;
}

/** How far the box's matched line sits from its origin, given the extent along that axis. */
function lineAt(line: 'far' | 'center', extent: number): number {
  return line === 'far' ? extent : extent / 2;
}

/** Strictly-closer wins; on a tie the far edge beats the centre, then the lower line. */
function beats(next: Hit, best: Hit): boolean {
  if (next.gap !== best.gap) return next.gap < best.gap;
  if (next.line !== best.line) return next.line === 'far';
  return next.candidate.position < best.candidate.position;
}

/**
 * The drawn guide: the CANDIDATE's line — not the box's edge, which is only
 * approaching it — extended to span both the neighbour and the resized box.
 */
function guideFor(candidate: SnapCandidate, origin: Point, size: Size): SnapGuide {
  const boxStart = candidate.axis === 'x' ? origin.y : origin.x;
  const boxEnd = boxStart + (candidate.axis === 'x' ? size.height : size.width);

  return {
    axis: candidate.axis,
    position: candidate.position,
    kind: candidate.kind,
    from: Math.min(candidate.from, boxStart),
    to: Math.max(candidate.to, boxEnd),
  };
}
