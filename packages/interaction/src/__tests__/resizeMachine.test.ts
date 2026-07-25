import { unsafeId, type NodeId } from '@vpb/core';
import { describe, expect, it } from 'vitest';

import { RESIZE_IDLE, resizeStep, type ResizeState } from '../resizeMachine.ts';
import type { Size } from '../resizeGeometry.ts';
import type { SnapCandidate } from '../snapGuides.ts';

/**
 * Pure transitions — no DOM, no store. The start size a `down` carries is measured
 * by the host; the machine only decides when a grab becomes a resize and what size
 * the pointer names. The geometry itself is `resizeGeometry.test.ts`; here we check
 * the sequence and that a move reaches through to a computed size.
 */

const NODE = unsafeId<NodeId>('node');
const START: Size = { width: 100, height: 50 };
const OPTS = { threshold: 4, minWidth: 8, minHeight: 8 };

const pending: ResizeState = {
  phase: 'pending',
  nodeId: NODE,
  handle: 'se',
  start: START,
  origin: { x: 0, y: 0 },
};
const resizing: ResizeState = { ...pending, phase: 'resizing' };

describe('arming', () => {
  it('a grab arms a pending resize but does nothing to the store yet', () => {
    const step = resizeStep(
      RESIZE_IDLE,
      { type: 'down', nodeId: NODE, handle: 'se', start: START, point: { x: 5, y: 5 } },
      OPTS,
    );
    expect(step.state).toEqual({
      phase: 'pending',
      nodeId: NODE,
      handle: 'se',
      start: START,
      origin: { x: 5, y: 5 },
    });
    expect(step.intent).toEqual({ type: 'none' });
  });

  it('a grab abandons a resize already in flight, reverting its preview', () => {
    const step = resizeStep(
      resizing,
      { type: 'down', nodeId: NODE, handle: 'n', start: START, point: { x: 1, y: 1 } },
      OPTS,
    );
    expect(step.state.phase).toBe('pending');
    expect(step.intent).toEqual({ type: 'cancel' });
  });
});

describe('the threshold', () => {
  it('stays pending — and silent — below the threshold', () => {
    const step = resizeStep(pending, { type: 'move', point: { x: 2, y: 2 }, aspect: false }, OPTS);
    expect(step.state).toBe(pending);
    expect(step.intent).toEqual({ type: 'none' });
  });

  it('begins resizing at exactly the threshold, previewing the new size', () => {
    // 3-4-5 triangle: distance is EXACTLY 5, so threshold 5 counts as crossed.
    const step = resizeStep(
      pending,
      { type: 'move', point: { x: 3, y: 4 }, aspect: false },
      { ...OPTS, threshold: 5 },
    );
    expect(step.state.phase).toBe('resizing');
    // se corner: width 100 + 3, height 50 + 4.
    expect(step.intent).toEqual({
      type: 'preview',
      nodeId: NODE,
      size: { width: 103, height: 54 },
      guides: [],
    });
  });
});

describe('resizing', () => {
  it('previews the computed size on each move', () => {
    const step = resizeStep(
      resizing,
      { type: 'move', point: { x: 40, y: 20 }, aspect: false },
      OPTS,
    );
    expect(step.state.phase).toBe('resizing');
    expect(step.intent).toEqual({
      type: 'preview',
      nodeId: NODE,
      size: { width: 140, height: 70 },
      guides: [],
    });
  });

  it('locks the aspect ratio when the move asks for it', () => {
    // start 100x50 -> ratio 2; se corner drives width 140, height follows 70.
    const step = resizeStep(resizing, { type: 'move', point: { x: 40, y: 5 }, aspect: true }, OPTS);
    expect(step.intent).toEqual({
      type: 'preview',
      nodeId: NODE,
      size: { width: 140, height: 70 },
      guides: [],
    });
  });

  it('commits on release', () => {
    const step = resizeStep(resizing, { type: 'up' }, OPTS);
    expect(step.state).toEqual(RESIZE_IDLE);
    expect(step.intent).toEqual({ type: 'commit' });
  });

  it('cancels on escape', () => {
    const step = resizeStep(resizing, { type: 'cancel' }, OPTS);
    expect(step.state).toEqual(RESIZE_IDLE);
    expect(step.intent).toEqual({ type: 'cancel' });
  });
});

describe('snapping', () => {
  /** A vertical line at `position`, spanning well clear of the box. */
  const line = (position: number): SnapCandidate => ({
    axis: 'x',
    position,
    kind: 'edge',
    from: 200,
    to: 300,
  });

  it('changes nothing when the host offers no lines — the pre-snap behaviour, exactly', () => {
    const withoutSnap = resizeStep(
      resizing,
      { type: 'move', point: { x: 40, y: 20 }, aspect: false },
      OPTS,
    );
    const withEmptySnap = resizeStep(
      resizing,
      {
        type: 'move',
        point: { x: 40, y: 20 },
        aspect: false,
        snap: { boxOrigin: { x: 0, y: 0 }, candidates: [] },
      },
      OPTS,
    );

    expect(withEmptySnap.intent).toEqual(withoutSnap.intent);
  });

  it('pulls the previewed size onto a nearby line and reports the guide', () => {
    // se corner from 100x50 by (40, 20) is 140x70; a line at 143 captures the edge.
    const step = resizeStep(
      resizing,
      {
        type: 'move',
        point: { x: 40, y: 20 },
        aspect: false,
        snap: { boxOrigin: { x: 0, y: 0 }, candidates: [line(143)] },
      },
      OPTS,
    );

    expect(step.intent).toMatchObject({
      type: 'preview',
      size: { width: 143, height: 70 },
    });
    expect(step.intent).toHaveProperty('guides', [
      { axis: 'x', position: 143, kind: 'edge', from: 0, to: 300 },
    ]);
  });

  it('does not snap a grab that has not crossed the threshold yet', () => {
    const step = resizeStep(
      pending,
      {
        type: 'move',
        point: { x: 1, y: 1 },
        aspect: false,
        snap: { boxOrigin: { x: 0, y: 0 }, candidates: [line(101)] },
      },
      OPTS,
    );

    // Still pending: a line near the untouched box must not start a resize.
    expect(step.state).toBe(pending);
    expect(step.intent).toEqual({ type: 'none' });
  });

  it('lets the minimum-size floor override a snap below it, and drops the guide with it', () => {
    // Dragging the se corner far up-left puts the raw width on the 40px floor. The
    // line at x=37 is within reach of that edge but BELOW the floor, so the floor
    // wins and the box does not reach it — and a guide may not claim otherwise.
    // (The box centre at x=20 is far out of range, so only the edge competes here.)
    const step = resizeStep(
      resizing,
      {
        type: 'move',
        point: { x: -95, y: -45 },
        aspect: false,
        snap: { boxOrigin: { x: 0, y: 0 }, candidates: [line(37)] },
      },
      { ...OPTS, minWidth: 40 },
    );

    expect(step.intent).toMatchObject({ size: { width: 40 } });
    expect(step.intent).toHaveProperty('guides', []);
  });

  describe('with the aspect ratio locked', () => {
    it('snaps the axis the handle drives and keeps the ratio exact', () => {
      // 'se' drives width. Raw 140x70 (ratio 2); a line at 144 takes the width, and
      // the height follows from the ratio rather than the pointer.
      const step = resizeStep(
        resizing,
        {
          type: 'move',
          point: { x: 40, y: 20 },
          aspect: true,
          snap: { boxOrigin: { x: 0, y: 0 }, candidates: [line(144)] },
        },
        OPTS,
      );

      expect(step.intent).toMatchObject({ size: { width: 144, height: 72 } });
    });

    it('declines a line it could only reach by breaking the ratio', () => {
      // A horizontal line 2px from the bottom edge — in range, but 'se' drives the
      // width, so honouring it would distort the locked box. The ratio wins.
      const step = resizeStep(
        resizing,
        {
          type: 'move',
          point: { x: 40, y: 20 },
          aspect: true,
          snap: {
            boxOrigin: { x: 0, y: 0 },
            candidates: [{ axis: 'y', position: 72, kind: 'edge', from: 200, to: 300 }],
          },
        },
        OPTS,
      );

      expect(step.intent).toMatchObject({ size: { width: 140, height: 70 } });
      expect(step.intent).toHaveProperty('guides', []);
    });
  });
});

describe('a click on a handle is not a resize', () => {
  it('releasing without crossing the threshold commits nothing', () => {
    const step = resizeStep(pending, { type: 'up' }, OPTS);
    expect(step.state).toEqual(RESIZE_IDLE);
    expect(step.intent).toEqual({ type: 'none' });
  });

  it('escaping a pending grab touches nothing', () => {
    const step = resizeStep(pending, { type: 'cancel' }, OPTS);
    expect(step.intent).toEqual({ type: 'none' });
  });

  it('a stray move with nothing armed is ignored', () => {
    const step = resizeStep(
      RESIZE_IDLE,
      { type: 'move', point: { x: 9, y: 9 }, aspect: false },
      OPTS,
    );
    expect(step.state).toEqual(RESIZE_IDLE);
    expect(step.intent).toEqual({ type: 'none' });
  });
});
