import { describe, expect, it } from 'vitest';

import { resizeSize, type ResizeConstraints, type Size } from '../resizeGeometry.ts';

/**
 * Pure arithmetic — no DOM, no store. The start size and the pointer delta are
 * fabricated; measuring them from the page is the host's job. Every case is a way
 * a resize can be subtly wrong: the wrong edge grows, the untouched axis moves, a
 * box shrinks past the floor, an aspect lock drives the wrong axis.
 */

const START: Size = { width: 100, height: 50 };
const FREE: ResizeConstraints = { minWidth: 0, minHeight: 0 };

describe('which edge grows', () => {
  it('east grows width with a rightward drag and leaves height alone', () => {
    expect(resizeSize(START, 'e', { x: 30, y: 99 }, FREE)).toEqual({ width: 130, height: 50 });
  });

  it('west grows width with a LEFTWARD drag — the far edge follows the pointer', () => {
    expect(resizeSize(START, 'w', { x: -30, y: 0 }, FREE)).toEqual({ width: 130, height: 50 });
    // And a rightward drag on the west edge shrinks it.
    expect(resizeSize(START, 'w', { x: 30, y: 0 }, FREE)).toEqual({ width: 70, height: 50 });
  });

  it('south grows height with a downward drag and leaves width alone', () => {
    expect(resizeSize(START, 's', { x: 99, y: 20 }, FREE)).toEqual({ width: 100, height: 70 });
  });

  it('north grows height with an UPWARD drag', () => {
    expect(resizeSize(START, 'n', { x: 0, y: -20 }, FREE)).toEqual({ width: 100, height: 70 });
    expect(resizeSize(START, 'n', { x: 0, y: 20 }, FREE)).toEqual({ width: 100, height: 30 });
  });

  it('a corner grows both axes at once', () => {
    expect(resizeSize(START, 'se', { x: 30, y: 20 }, FREE)).toEqual({ width: 130, height: 70 });
    expect(resizeSize(START, 'nw', { x: -30, y: -20 }, FREE)).toEqual({ width: 130, height: 70 });
  });
});

describe('the minimum size', () => {
  it('clamps a box dragged smaller than the floor', () => {
    const min: ResizeConstraints = { minWidth: 8, minHeight: 8 };
    expect(resizeSize(START, 'se', { x: -200, y: -200 }, min)).toEqual({ width: 8, height: 8 });
  });

  it('clamps only the axis that crossed the floor', () => {
    const min: ResizeConstraints = { minWidth: 8, minHeight: 8 };
    // Width dragged well below the floor, height still comfortably above it.
    expect(resizeSize(START, 'se', { x: -200, y: 10 }, min)).toEqual({ width: 8, height: 60 });
  });
});

describe('the aspect-ratio lock', () => {
  it('derives height from width on a corner, so the ratio holds', () => {
    const locked: ResizeConstraints = { minWidth: 0, minHeight: 0, aspectRatio: 2 };
    // width 100 -> 140, height follows as 140 / 2 = 70, regardless of the y delta.
    expect(resizeSize(START, 'se', { x: 40, y: 0 }, locked)).toEqual({ width: 140, height: 70 });
    expect(resizeSize(START, 'se', { x: 40, y: 999 }, locked)).toEqual({ width: 140, height: 70 });
  });

  it('derives width from height on a pure vertical handle', () => {
    const locked: ResizeConstraints = { minWidth: 0, minHeight: 0, aspectRatio: 2 };
    // north drives height 50 -> 80, width follows as 80 * 2 = 160.
    expect(resizeSize(START, 'n', { x: 0, y: -30 }, locked)).toEqual({ width: 160, height: 80 });
  });
});
