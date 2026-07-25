import type { NodeId } from '@vpb/core';
import type { EditorStore } from '@vpb/state';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

/**
 * THE SELECTION OVERLAY — a box over each selected element, kept in sync.
 *
 * It lives in the EDITOR document, not the sandboxed frame: the frame is the
 * user's page and carries none of the editor's chrome. So the overlay is drawn
 * here, over the iframe, and reads element positions out of the frame's document.
 *
 * AUDIT §4.14: the prototype measured the selection box only when the selected id
 * changed — "no ResizeObserver, no scroll listener, no MutationObserver. The
 * selection box desyncs on iframe scroll, resize, or webfont load." So this
 * re-measures on all four: the element's own size, the surrounding layout, the
 * frame scrolling, and the window resizing.
 *
 * It reads `present.context.selection`, not `committed` — the same rule the canvas
 * follows. A future drag will preview a selection change, and the box must move
 * with the preview.
 */

interface Box {
  readonly id: NodeId;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface SelectionLayerProps {
  readonly store: StoreApi<EditorStore>;
  /** The frame document, once `CanvasFrame` has adopted it (null before then). */
  readonly doc: Document | null;
}

export function SelectionLayer({ store, doc }: SelectionLayerProps) {
  const selection = useStore(store, (state) => state.present.context.selection);
  const layerRef = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<readonly Box[]>([]);

  /**
   * Measure each selected element relative to the overlay's own origin.
   *
   * Both rects are viewport-relative, so subtracting the layer's origin cancels
   * any outer scroll — the overlay and the iframe move together. Only scrolling
   * *inside* the frame moves an element relative to the overlay, which is why the
   * frame document gets its own scroll listener below.
   */
  const measure = useCallback(() => {
    const layer = layerRef.current;
    if (!doc || !layer) {
      setBoxes([]);
      return;
    }
    const origin = layer.getBoundingClientRect();
    const next: Box[] = [];
    for (const id of selection) {
      const element = doc.querySelector(`[data-vpb-node-id="${id}"]`);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      next.push({
        id,
        left: rect.left - origin.left,
        top: rect.top - origin.top,
        width: rect.width,
        height: rect.height,
      });
    }
    setBoxes(next);
  }, [doc, selection]);

  useLayoutEffect(() => {
    measure();
    if (!doc) return;

    const resize = new ResizeObserver(measure);
    resize.observe(doc.body);
    for (const id of selection) {
      const element = doc.querySelector(`[data-vpb-node-id="${id}"]`);
      if (element) resize.observe(element);
    }

    const mutation = new MutationObserver(measure);
    mutation.observe(doc.body, { attributes: true, childList: true, subtree: true });

    // Capture, because scrolls inside the frame do not bubble to the document.
    doc.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);

    return () => {
      resize.disconnect();
      mutation.disconnect();
      doc.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [doc, selection, measure]);

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      {boxes.map((box) => (
        <div
          key={box.id}
          data-vpb-selection={box.id}
          className="absolute border-2"
          style={{
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            borderColor: 'var(--vpb-color-selection)',
          }}
        />
      ))}
    </div>
  );
}
