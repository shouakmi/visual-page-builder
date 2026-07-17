/* Drag geometry — where a drop would land, as pure arithmetic on rectangles. */
export { dropTarget } from './dropTarget.ts';
export type { Point, Rect, DropAxis, DropChild, DropZone, Drop } from './dropTarget.ts';

/* Drag lifecycle — press, threshold, move, release/escape as a pure state machine. */
export { dragStep, IDLE } from './dragMachine.ts';
export type { DragState, DragInput, DragIntent, DragOptions, DragStep } from './dragMachine.ts';
