import { unsafeId, type NodeId } from '@vpb/core';
import { describe, expect, it } from 'vitest';

import { RESIZE_IDLE, resizeStep, type ResizeState } from '../resizeMachine.ts';
import type { Size } from '../resizeGeometry.ts';

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
    });
  });

  it('locks the aspect ratio when the move asks for it', () => {
    // start 100x50 -> ratio 2; se corner drives width 140, height follows 70.
    const step = resizeStep(resizing, { type: 'move', point: { x: 40, y: 5 }, aspect: true }, OPTS);
    expect(step.intent).toEqual({
      type: 'preview',
      nodeId: NODE,
      size: { width: 140, height: 70 },
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
