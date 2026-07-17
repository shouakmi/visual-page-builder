import { unsafeId, type NodeId } from '@vpb/core';
import { describe, expect, it } from 'vitest';

import { dragStep, IDLE, type DragState } from '../dragMachine.ts';
import type { Drop } from '../dropTarget.ts';

/**
 * Pure transitions — no DOM, no store. The drop a `move` carries is fabricated,
 * because resolving it from the page is the host's job; the machine only decides
 * what to do with it.
 */

const NODE = unsafeId<NodeId>('node');
const OPTS = { threshold: 4 };
const drop: Drop = { parentId: unsafeId<NodeId>('parent'), index: 2 };

const pending: DragState = { phase: 'pending', nodeId: NODE, origin: { x: 0, y: 0 } };
const dragging: DragState = { phase: 'dragging', nodeId: NODE, origin: { x: 0, y: 0 } };

describe('arming', () => {
  it('a press arms a pending drag but does nothing to the store yet', () => {
    const step = dragStep(IDLE, { type: 'down', nodeId: NODE, point: { x: 5, y: 5 } }, OPTS);
    expect(step.state).toEqual({ phase: 'pending', nodeId: NODE, origin: { x: 5, y: 5 } });
    expect(step.intent).toEqual({ type: 'none' });
  });

  it('a press abandons a drag already in flight, reverting its preview', () => {
    const step = dragStep(dragging, { type: 'down', nodeId: NODE, point: { x: 1, y: 1 } }, OPTS);
    expect(step.state.phase).toBe('pending');
    expect(step.intent).toEqual({ type: 'cancel' });
  });
});

describe('the threshold', () => {
  it('stays pending — and silent — below the threshold', () => {
    const step = dragStep(pending, { type: 'move', point: { x: 2, y: 2 }, drop }, OPTS);
    expect(step.state).toBe(pending);
    expect(step.intent).toEqual({ type: 'none' });
  });

  it('begins dragging at exactly the threshold', () => {
    // 3-4-5 triangle: distance is EXACTLY 5, so threshold 5 must count as crossed
    // (`>=`, not `>`) — the boundary a drag either fires on or misses.
    const step = dragStep(pending, { type: 'move', point: { x: 3, y: 4 }, drop }, { threshold: 5 });
    expect(step.state.phase).toBe('dragging');
    expect(step.intent).toEqual({ type: 'preview', nodeId: NODE, drop });
  });
});

describe('dragging', () => {
  it('previews the resolved drop on each move', () => {
    const step = dragStep(dragging, { type: 'move', point: { x: 50, y: 50 }, drop }, OPTS);
    expect(step.state.phase).toBe('dragging');
    expect(step.intent).toEqual({ type: 'preview', nodeId: NODE, drop });
  });

  it('clears the preview when the pointer is over no valid target', () => {
    const step = dragStep(dragging, { type: 'move', point: { x: 50, y: 50 }, drop: null }, OPTS);
    expect(step.intent).toEqual({ type: 'clearPreview' });
  });

  it('commits on release', () => {
    const step = dragStep(dragging, { type: 'up' }, OPTS);
    expect(step.state).toEqual(IDLE);
    expect(step.intent).toEqual({ type: 'commit' });
  });

  it('cancels on escape', () => {
    const step = dragStep(dragging, { type: 'cancel' }, OPTS);
    expect(step.state).toEqual(IDLE);
    expect(step.intent).toEqual({ type: 'cancel' });
  });
});

describe('a click is not a drag', () => {
  it('releasing without crossing the threshold commits nothing', () => {
    const step = dragStep(pending, { type: 'up' }, OPTS);
    expect(step.state).toEqual(IDLE);
    expect(step.intent).toEqual({ type: 'none' });
  });

  it('escaping a pending press touches nothing', () => {
    const step = dragStep(pending, { type: 'cancel' }, OPTS);
    expect(step.intent).toEqual({ type: 'none' });
  });

  it('a stray move with nothing armed is ignored', () => {
    const step = dragStep(IDLE, { type: 'move', point: { x: 9, y: 9 }, drop }, OPTS);
    expect(step.state).toEqual(IDLE);
    expect(step.intent).toEqual({ type: 'none' });
  });
});
