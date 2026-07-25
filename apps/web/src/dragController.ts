import type { NodeId } from '@vpb/core';
import {
  IDLE,
  dragStep,
  type Drop,
  type DragIntent,
  type DragState,
  type Point,
} from '@vpb/interaction';
import { moveNodeCommand, type EditorStore } from '@vpb/state';
import type { StoreApi } from 'zustand/vanilla';

/**
 * THE DRAG CONTROLLER — the drag machine wired to the store.
 *
 * This is the testable seam between the pure `dragStep` (which decides) and the DOM
 * (which measures). It takes pointer facts — `down`/`move`/`up`/`cancel`, with the
 * resolved drop handed in — advances the machine, and turns each intent into a
 * store call: a drag PREVIEWS `moveNodeCommand` on `present` and COMMITS it to
 * history on release, so a drag in flight is never an undo step and a cancelled one
 * leaves nothing behind. Exactly the `preview`/`commitPreview`/`cancelPreview`
 * contract Phase C built for this.
 *
 * It never touches an element. The host feeds it the drop (from `dropTarget` over
 * measured rects), so this whole file is unit-testable against a real store with no
 * layout — which is the point, because jsdom has none.
 */

export interface DragController {
  down(nodeId: NodeId, point: Point): void;
  move(point: Point, drop: Drop | null): void;
  up(): void;
  cancel(): void;
  isDragging(): boolean;
}

export interface DragControllerOptions {
  /** Travel before a press becomes a drag. Default 4px. */
  readonly threshold?: number;
  /**
   * Fired when the drag actually begins and ends, so the host can capture the
   * pointer and raise the iframe shield for the duration and drop them after.
   */
  readonly onDraggingChange?: (dragging: boolean) => void;
}

export function createDragController(
  store: StoreApi<EditorStore>,
  options: DragControllerOptions = {},
): DragController {
  const threshold = options.threshold ?? 4;
  let state: DragState = IDLE;

  const apply = (intent: DragIntent): void => {
    switch (intent.type) {
      case 'preview':
        store
          .getState()
          .preview(moveNodeCommand(intent.nodeId, intent.drop.parentId, intent.drop.index));
        break;
      case 'clearPreview':
      case 'cancel':
        store.getState().cancelPreview();
        break;
      case 'commit':
        store.getState().commitPreview();
        break;
      case 'none':
        break;
    }
  };

  const run = (input: Parameters<typeof dragStep>[1]): void => {
    const wasDragging = state.phase === 'dragging';
    const step = dragStep(state, input, { threshold });
    state = step.state;
    apply(step.intent);
    const nowDragging = state.phase === 'dragging';
    if (nowDragging !== wasDragging) options.onDraggingChange?.(nowDragging);
  };

  return {
    down: (nodeId, point) => run({ type: 'down', nodeId, point }),
    move: (point, drop) => run({ type: 'move', point, drop }),
    up: () => run({ type: 'up' }),
    cancel: () => run({ type: 'cancel' }),
    isDragging: () => state.phase === 'dragging',
  };
}
