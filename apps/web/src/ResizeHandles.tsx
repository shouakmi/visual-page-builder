import type { NodeId } from '@vpb/core';
import type { ResizeHandle, Size } from '@vpb/interaction';
import type { EditorStore } from '@vpb/state';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import type { ResizeController } from './resizeController.ts';

/**
 * THE RESIZE HANDLES — eight grips on the selected box, wired to the controller.
 *
 * The sibling of `SelectionLayer`, and it lives in the same place: the EDITOR
 * document, over the frame, reading the element's rect out of the frame. But where
 * the selection overlay is `pointer-events-none` so clicks fall through to the
 * frame, the handles are `pointer-events-auto` — grabbing one is the whole gesture,
 * and it must NOT reach the frame's selection listener underneath.
 *
 * Single selection only in v1: a resize writes one node's width/height, and "resize
 * all selected" is an E4 multi-select concern. The DECISION (threshold, the size
 * math, preview/commit) is the tested controller + `resizeMachine`; this component
 * only measures the start size once at grab time and shows the grips. That one
 * `getBoundingClientRect` is the browser-pending part — jsdom lays nothing out, so
 * the grips' PIXELS are only right in a real browser; the tests stub the read.
 */

export interface ResizeHandlesProps {
  readonly store: StoreApi<EditorStore>;
  /** The frame document, once `CanvasFrame` has adopted it (null before then). */
  readonly doc: Document | null;
  readonly controller: ResizeController;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Clockwise from the top-left, so the tab order round-trips the box. */
const HANDLES: readonly ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const CURSORS: Record<ResizeHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

const SIZE = 10;

export function ResizeHandles({ store, doc, controller }: ResizeHandlesProps) {
  // Single selection only: handles show when exactly one node is selected.
  const selected = useStore(store, (state) =>
    state.present.context.selection.length === 1 ? state.present.context.selection[0] : undefined,
  );
  const layerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);

  const elementFor = useCallback(
    (id: NodeId): Element | null => doc?.querySelector(`[data-vpb-node-id="${id}"]`) ?? null,
    [doc],
  );

  const measure = useCallback(() => {
    const layer = layerRef.current;
    const element = selected ? elementFor(selected) : null;
    if (!layer || !element) {
      setBox(null);
      return;
    }
    const origin = layer.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    setBox({
      left: rect.left - origin.left,
      top: rect.top - origin.top,
      width: rect.width,
      height: rect.height,
    });
  }, [selected, elementFor]);

  useLayoutEffect(() => {
    measure();
    if (!doc || !selected) return;

    const resize = new ResizeObserver(measure);
    resize.observe(doc.body);
    const element = elementFor(selected);
    if (element) resize.observe(element);

    const mutation = new MutationObserver(measure);
    mutation.observe(doc.body, { attributes: true, childList: true, subtree: true });

    doc.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      resize.disconnect();
      mutation.disconnect();
      doc.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [doc, selected, elementFor, measure]);

  // The layer itself renders whenever a node is selected so its ref attaches and
  // `measure` can run; the grips wait for the measured box. Gating the ref on `box`
  // would deadlock — no ref, no measure, no box, forever.
  if (!selected) return null;

  const grab = (handle: ResizeHandle) => (event: PointerEvent<HTMLDivElement>) => {
    // The grip owns this gesture; do not let the press reach the frame's selection
    // listener or start a structural drag underneath.
    event.stopPropagation();
    const element = elementFor(selected);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const start: Size = { width: rect.width, height: rect.height };
    // Capture on the grip so move/up keep arriving here once the pointer leaves it
    // (and the iframe) — the §4.1 lesson the drag learned, applied to resize.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Not capturable (a synthetic event, a released pointer); the resize still
      // works while the pointer is over the grip, which is the common case.
    }
    controller.down(selected, handle, start, { x: event.clientX, y: event.clientY });
  };

  // Forwarded unconditionally: the FIRST move is the one that crosses the threshold,
  // so gating on "already resizing" would swallow it. The machine ignores a move or
  // release it never armed (idle -> intent none), so a stray hover costs nothing.
  const track = (event: PointerEvent<HTMLDivElement>) => {
    controller.move({ x: event.clientX, y: event.clientY }, event.shiftKey);
  };

  const release = (event: PointerEvent<HTMLDivElement>) => {
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Already released by the browser on pointerup; nothing to do.
    }
    controller.up();
  };

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 overflow-hidden">
      {box &&
        HANDLES.map((handle) => (
          <div
            key={handle}
            data-vpb-resize-handle={handle}
            role="slider"
            aria-label={`Resize ${handle}`}
            onPointerDown={grab(handle)}
            onPointerMove={track}
            onPointerUp={release}
            className="pointer-events-auto absolute rounded-sm border bg-white"
            style={{
              ...positionOf(handle, box),
              width: SIZE,
              height: SIZE,
              marginLeft: -SIZE / 2,
              marginTop: -SIZE / 2,
              cursor: CURSORS[handle],
              borderColor: 'var(--vpb-color-selection)',
            }}
          />
        ))}
    </div>
  );
}

/** The grip's center, from the box edges the handle sits on. */
function positionOf(handle: ResizeHandle, box: Box): CSSProperties {
  const left = handle.includes('w')
    ? box.left
    : handle.includes('e')
      ? box.left + box.width
      : box.left + box.width / 2;
  const top = handle.includes('n')
    ? box.top
    : handle.includes('s')
      ? box.top + box.height
      : box.top + box.height / 2;
  return { left, top };
}
