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
  type SnapGuide,
  type SnapInput,
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
  /**
   * The alignment lines available to the node being resized, asked for on every
   * move because the page reflows underneath the gesture.
   *
   * A provider rather than a value, and it is the host's job because it reads the
   * DOM — this controller never touches an element, which is what keeps it
   * testable against a real store with no layout. Absent means no snapping.
   */
  readonly snapFor?: (nodeId: NodeId) => SnapInput | null;
  /** The lines the size landed on, for the overlay to draw. Emptied when the gesture ends. */
  readonly onGuidesChange?: (guides: readonly SnapGuide[]) => void;
}

/**
 * One shared empty array, so "still nothing snapped" is reference-identical from
 * one move to the next and React can skip the re-render.
 */
const NO_GUIDES: readonly SnapGuide[] = [];

export function createResizeController(
  store: StoreApi<EditorStore>,
  options: ResizeControllerOptions,
): ResizeController {
  const threshold = options.threshold ?? 4;
  const minWidth = options.minWidth ?? 8;
  const minHeight = options.minHeight ?? 8;
  let state: ResizeState = RESIZE_IDLE;
  let ruleId: StyleRuleId | null = null;

  const emitGuides = (guides: readonly SnapGuide[]): void => {
    options.onGuidesChange?.(guides.length === 0 ? NO_GUIDES : guides);
  };

  const apply = (intent: ResizeIntent): void => {
    // Commit and cancel both END the gesture, so the guides go with it either way —
    // a line left on screen afterwards describes an alignment nothing is doing.
    if (intent.type === 'commit' || intent.type === 'cancel') emitGuides(NO_GUIDES);

    switch (intent.type) {
      case 'preview': {
        emitGuides(intent.guides);
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
    move: (point, aspect) => {
      // Asked for per move, against the node the gesture armed. The machine ignores
      // a move it never armed, so an idle stray costs no measurement either.
      const nodeId = state.phase === 'idle' ? null : state.nodeId;
      const snap = nodeId !== null ? (options.snapFor?.(nodeId) ?? null) : null;
      run({ type: 'move', point, aspect, ...(snap !== null ? { snap } : {}) });
    },
    up: () => run({ type: 'up' }),
    cancel: () => run({ type: 'cancel' }),
    isResizing: () => state.phase === 'resizing',
  };
}
