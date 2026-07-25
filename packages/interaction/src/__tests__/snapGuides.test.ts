import { describe, expect, it } from 'vitest';

import type { Rect } from '../dropTarget.ts';
import { snapCandidates, snapSize, type SnapCandidate, type SnapOptions } from '../snapGuides.ts';

/**
 * Pure arithmetic — no DOM, no store. The app measures the rects; everything here
 * is the decision made from them, which is the part that can be wrong in ways a
 * screenshot would not reveal.
 *
 * The box under test starts at the origin so the numbers stay readable: top-left
 * (0, 0), 100 wide, 50 tall. Its movable lines are therefore the right edge at
 * x=100, the centre at x=50, the bottom at y=50 and the middle at y=25 — and its
 * left/top never move, because the model has no `left`/`top` to write.
 */

const ORIGIN = { x: 0, y: 0 };
const PROPOSED = { width: 100, height: 50 };
const OPTS: SnapOptions = { threshold: 5 };

/** A vertical line at `position`, spanning y 200..300 (a neighbour below the box). */
function verticalLine(position: number, kind: 'edge' | 'center' = 'edge'): SnapCandidate {
  return { axis: 'x', position, kind, from: 200, to: 300 };
}

/** A horizontal line at `position`, spanning x 200..300. */
function horizontalLine(position: number, kind: 'edge' | 'center' = 'edge'): SnapCandidate {
  return { axis: 'y', position, kind, from: 200, to: 300 };
}

describe('the lines a neighbour offers', () => {
  const rect: Rect = { left: 10, top: 20, width: 100, height: 40 };

  it('offers both edges and the midline on both axes', () => {
    const candidates = snapCandidates([rect]);

    expect(candidates.filter((c) => c.axis === 'x').map((c) => c.position)).toEqual([10, 60, 110]);
    expect(candidates.filter((c) => c.axis === 'y').map((c) => c.position)).toEqual([20, 40, 60]);
  });

  it('marks the midlines as centres and the outsides as edges', () => {
    const kinds = snapCandidates([rect])
      .filter((c) => c.axis === 'x')
      .map((c) => c.kind);

    expect(kinds).toEqual(['edge', 'center', 'edge']);
  });

  it('spans each line across the source it came from, so the guide can connect them', () => {
    const [firstX] = snapCandidates([rect]);
    const firstY = snapCandidates([rect]).find((c) => c.axis === 'y');

    // A vertical line runs down the source's height; a horizontal one across its width.
    expect(firstX).toMatchObject({ from: 20, to: 60 });
    expect(firstY).toMatchObject({ from: 10, to: 110 });
  });

  it('offers nothing for no neighbours', () => {
    expect(snapCandidates([])).toEqual([]);
  });
});

describe('capturing an edge', () => {
  it('pulls the right edge onto a line just past it', () => {
    const result = snapSize(ORIGIN, PROPOSED, [verticalLine(103)], OPTS);

    expect(result.size).toEqual({ width: 103, height: 50 });
    expect(result.guides).toHaveLength(1);
  });

  it('captures at exactly the threshold', () => {
    const result = snapSize(ORIGIN, PROPOSED, [verticalLine(105)], OPTS);

    expect(result.size.width).toBe(105);
  });

  it('leaves the size alone one pixel beyond the threshold', () => {
    const result = snapSize(ORIGIN, PROPOSED, [verticalLine(106)], OPTS);

    expect(result.size).toEqual(PROPOSED);
    expect(result.guides).toEqual([]);
  });

  it('changes nothing when there is nothing to align to', () => {
    const result = snapSize(ORIGIN, PROPOSED, [], OPTS);

    expect(result.size).toEqual(PROPOSED);
    expect(result.guides).toEqual([]);
  });
});

describe('the centre moves at half the rate of the edge', () => {
  it('closes a centre gap by changing the width TWICE as much', () => {
    // The box's centre sits at x=50; the line is 2px past it. Moving the centre 2px
    // means growing the width 4px, because the left edge is pinned by the layout.
    const result = snapSize(ORIGIN, PROPOSED, [verticalLine(52, 'center')], OPTS);

    expect(result.size.width).toBe(104);
  });

  it('prefers the nearer line whichever of the box lines it matches', () => {
    // Right edge 100 vs a line at 108 (gap 8, out of range); centre 50 vs a line at
    // 51 (gap 1). Only the centre is in range.
    const result = snapSize(ORIGIN, PROPOSED, [verticalLine(108), verticalLine(51)], OPTS);

    expect(result.size.width).toBe(102);
  });
});

describe('the two axes are independent', () => {
  it('aligns the right edge and the bottom to different neighbours at once', () => {
    const result = snapSize(ORIGIN, PROPOSED, [verticalLine(103), horizontalLine(48)], OPTS);

    expect(result.size).toEqual({ width: 103, height: 48 });
    expect(result.guides.map((g) => g.axis)).toEqual(['x', 'y']);
  });

  it('snaps one axis while the other stays exactly where the pointer put it', () => {
    const result = snapSize(ORIGIN, PROPOSED, [horizontalLine(48)], OPTS);

    expect(result.size).toEqual({ width: 100, height: 48 });
    expect(result.guides.map((g) => g.axis)).toEqual(['y']);
  });
});

describe('choosing between lines', () => {
  it('takes the closest one', () => {
    const result = snapSize(
      ORIGIN,
      PROPOSED,
      [verticalLine(104), verticalLine(101), verticalLine(103)],
      OPTS,
    );

    expect(result.size.width).toBe(101);
  });

  it('breaks a tie towards the edge the user is dragging, not the centre', () => {
    // Both are 2px away: the far edge from a line at 102, the centre from one at 52.
    const result = snapSize(
      ORIGIN,
      PROPOSED,
      [verticalLine(52, 'center'), verticalLine(102)],
      OPTS,
    );

    expect(result.size.width).toBe(102);
  });

  it('breaks a remaining tie deterministically, not by collection order', () => {
    // 97 and 103 are both 3px from the right edge. The lower line wins either way
    // round, so the result cannot depend on which neighbour was measured first.
    const lower = snapSize(ORIGIN, PROPOSED, [verticalLine(97), verticalLine(103)], OPTS);
    const reversed = snapSize(ORIGIN, PROPOSED, [verticalLine(103), verticalLine(97)], OPTS);

    expect(lower.size.width).toBe(97);
    expect(reversed.size.width).toBe(97);
  });

  it('ignores a line the box could only reach by inverting itself', () => {
    // A 2px-wide box whose left edge is pinned at x=0: the line at x=0 is 2px from
    // its right edge, but landing on it means zero width. Not a candidate.
    const result = snapSize(ORIGIN, { width: 2, height: 50 }, [verticalLine(0)], OPTS);

    expect(result.size).toEqual({ width: 2, height: 50 });
    expect(result.guides).toEqual([]);
  });
});

describe('the guide that explains the snap', () => {
  it('is drawn on the line it captured, not on the edge that moved', () => {
    const result = snapSize(ORIGIN, PROPOSED, [verticalLine(103)], OPTS);

    // 103 is the line; 100 was the box's edge before it moved. Reporting the latter
    // would draw the guide beside the thing it claims to align with.
    expect(result.guides[0]?.position).toBe(103);
  });

  it('stretches to span both the neighbour and the box', () => {
    // The neighbour spans y 200..300; the box spans y 0..50. The guide covers both,
    // so the line visibly connects them.
    const result = snapSize(ORIGIN, PROPOSED, [verticalLine(103)], OPTS);

    expect(result.guides[0]).toMatchObject({ from: 0, to: 300 });
  });

  it('carries the kind of line it landed on', () => {
    const result = snapSize(ORIGIN, PROPOSED, [verticalLine(52, 'center')], OPTS);

    expect(result.guides[0]?.kind).toBe('center');
  });

  it('reports no guide when nothing was captured', () => {
    const result = snapSize(ORIGIN, PROPOSED, [verticalLine(300)], OPTS);

    expect(result.guides).toEqual([]);
  });
});

describe('under an aspect lock', () => {
  // Ratio 2 (100x50). The lock is the user asking for the ratio, and it never bends;
  // snapping stays on and simply confines itself to what the ratio allows.
  const locked: SnapOptions = { threshold: 5, aspectRatio: 2, driven: 'x' };

  it('snaps the driven axis and derives the other from the ratio', () => {
    const result = snapSize(ORIGIN, PROPOSED, [verticalLine(104)], locked);

    expect(result.size).toEqual({ width: 104, height: 52 });
    expect(result.size.width / result.size.height).toBe(2);
  });

  it('declines a line on the axis it does not drive, rather than breaking the ratio', () => {
    // The bottom edge is 2px from a line, well within the threshold — but honouring
    // it would need a height the ratio does not permit. The ratio wins; no snap.
    const result = snapSize(ORIGIN, PROPOSED, [horizontalLine(48)], locked);

    expect(result.size).toEqual(PROPOSED);
    expect(result.guides).toEqual([]);
  });

  it('never reports more than the one guide it could honour', () => {
    const result = snapSize(ORIGIN, PROPOSED, [verticalLine(104), horizontalLine(48)], locked);

    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]?.axis).toBe('x');
  });

  it('drives the height instead when the handle is a side grip', () => {
    const result = snapSize(ORIGIN, PROPOSED, [horizontalLine(52)], {
      ...locked,
      driven: 'y',
    });

    expect(result.size).toEqual({ width: 104, height: 52 });
  });
});
