import {
  nodeScope,
  px,
  target as styleTarget,
  type IdFactory,
  type NodeId,
  type StyleRuleId,
} from '@vpb/core';
import {
  RESIZE_IDLE,
  resizeStep,
  type Point,
  type ResizeHandle,
  type ResizeIntent,
  type ResizeState,
  type Size,
} from '@vpb/interaction';
import { setStylePropertiesCommand, type EditorStore } from '@vpb/state';
import type { StoreApi } from 'zustand/vanilla';

/**
 * THE RESIZE CONTROLLER — the resize machine wired to the store.
 *
 * The sibling of `dragController`, and the same testable seam: it turns pointer
 * facts — `down`/`move`/`up`/`cancel`, with the start size handed in — into store
 * calls. A resize PREVIEWS width/height on `present` and COMMITS them to history on
 * release, so a resize in flight is never an undo step and a cancelled one leaves
 * nothing behind. Width and height go through `setStylePropertiesCommand` as ONE
 * command, so a corner resize is one history entry.
 *
 * Two decisions the mutation set pins:
 *
 * - It writes the ACTIVE breakpoint's target, never base. Resizing while the canvas
 *   emulates mobile must write the mobile rule, or the canvas and the export
 *   disagree — the WYSIWYG hole D4 closed for device sizing.
 * - It mints ONE rule id per gesture, at `down`. The rule id is only consumed when
 *   no rule exists for that (scope, target) yet, but a fresh one per gesture is
 *   required: reusing an id across gestures on different nodes would stamp two
 *   distinct rules with the same identity. Reading it at preview time would be too
 *   late — the first preview creates the rule.
 *
 * It never touches an element; the host measures the start size (one
 * `getBoundingClientRect` at grab time) and feeds it in. So the whole
 * preview/commit/cancel contract is unit-testable against a real store with no
 * layout, which is the point, because jsdom has none.
 */

export interface ResizeController {
  down(nodeId: NodeId, handle: ResizeHandle, start: Size, point: Point): void;
  move(point: Point, aspect: boolean): void;
  up(): void;
  cancel(): void;
  isResizing(): boolean;
}

export interface ResizeControllerOptions {
  /** Mints the one rule id a gesture may need. See the note above on why per-gesture. */
  readonly ids: IdFactory;
  /** Travel before a grab becomes a resize. Default 4px. */
  readonly threshold?: number;
  /** The floor a box cannot resize below. Default 8px — small, but still selectable. */
  readonly minWidth?: number;
  readonly minHeight?: number;
  /**
   * Fired when the resize actually begins and ends, so the host can capture the
   * pointer and raise its shield for the duration and drop them after.
   */
  readonly onResizingChange?: (resizing: boolean) => void;
}

export function createResizeController(
  store: StoreApi<EditorStore>,
  options: ResizeControllerOptions,
): ResizeController {
  const threshold = options.threshold ?? 4;
  const minWidth = options.minWidth ?? 8;
  const minHeight = options.minHeight ?? 8;
  let state: ResizeState = RESIZE_IDLE;
  let ruleId: StyleRuleId | null = null;

  const apply = (intent: ResizeIntent): void => {
    switch (intent.type) {
      case 'preview': {
        // The command applies to `committed`, so read the breakpoint from there —
        // the target must be the one the recorded entry will belong to.
        const breakpoint = store.getState().committed.context.activeBreakpointId;
        store.getState().preview(
          setStylePropertiesCommand(
            nodeScope(intent.nodeId),
            styleTarget(breakpoint),
            [
              { property: 'width', value: px(intent.size.width) },
              { property: 'height', value: px(intent.size.height) },
            ],
            ruleId ?? options.ids.styleRule(),
          ),
        );
        break;
      }
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

  const run = (input: Parameters<typeof resizeStep>[1]): void => {
    const wasResizing = state.phase === 'resizing';
    const step = resizeStep(state, input, { threshold, minWidth, minHeight });
    state = step.state;
    apply(step.intent);
    const nowResizing = state.phase === 'resizing';
    if (nowResizing !== wasResizing) options.onResizingChange?.(nowResizing);
  };

  return {
    down: (nodeId, handle, start, point) => {
      // A fresh rule id per gesture — see the note above.
      ruleId = options.ids.styleRule();
      run({ type: 'down', nodeId, handle, start, point });
    },
    move: (point, aspect) => run({ type: 'move', point, aspect }),
    up: () => run({ type: 'up' }),
    cancel: () => run({ type: 'cancel' }),
    isResizing: () => state.phase === 'resizing',
  };
}
