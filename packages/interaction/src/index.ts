/* Drag geometry — where a drop would land, as pure arithmetic on rectangles. */
export { dropTarget } from './dropTarget.ts';
export type { Point, Rect, DropAxis, DropChild, DropZone, Drop } from './dropTarget.ts';

/* Drag lifecycle — press, threshold, move, release/escape as a pure state machine. */
export { dragStep, IDLE } from './dragMachine.ts';
export type { DragState, DragInput, DragIntent, DragOptions, DragStep } from './dragMachine.ts';

/* Resize geometry — how big a resize would make the box, as pure arithmetic on rectangles. */
export { resizeSize, drivesHorizontally } from './resizeGeometry.ts';
export type { ResizeHandle, Size, ResizeConstraints } from './resizeGeometry.ts';

/* Snap geometry — which neighbouring line a resize should land on, and the guide to draw. */
export { snapCandidates, snapSize } from './snapGuides.ts';
export type {
  SnapAxis,
  SnapKind,
  SnapCandidate,
  SnapGuide,
  SnapOptions,
  SnapResult,
} from './snapGuides.ts';

/* Resize lifecycle — grab, threshold, move, release/escape as a pure state machine. */
export { resizeStep, RESIZE_IDLE } from './resizeMachine.ts';
export type {
  ResizeState,
  ResizeInput,
  ResizeIntent,
  ResizeOptions,
  ResizeStep,
  SnapInput,
} from './resizeMachine.ts';
