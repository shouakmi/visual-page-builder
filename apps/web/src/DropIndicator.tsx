import { childrenOf, type NodeTree } from '@vpb/core';
import type { Drop } from '@vpb/interaction';
import { useLayoutEffect, useRef, useState } from 'react';

/**
 * THE DROP INDICATOR — a line at the gap a drop would land in.
 *
 * During a drag the canvas previews the move, but the user also needs to see WHERE
 * the release will place the node: the gap the pointer currently names. This draws
 * that line, in the editor overlay over the frame, from the drop the controller
 * resolved (`{parentId, index}`) and the measured positions of that parent's
 * children.
 *
 * Its geometry is browser-pending like every rect read — jsdom lays nothing out, so
 * the line's PIXELS are only right in a real browser. What is verified here is that
 * it appears for the right target (`data-vpb-drop-parent`/`-index`) and vanishes
 * when there is nothing to drop onto.
 */

export interface DropIndicatorProps {
  readonly doc: Document | null;
  readonly tree: NodeTree;
  /** The drop the drag resolved, or null when there is no valid target. */
  readonly drop: Drop | null;
}

interface Line {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A thin bar. Horizontal for a vertical stack, and vice versa. */
const THICKNESS = 2;

export function DropIndicator({ doc, tree, drop }: DropIndicatorProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [line, setLine] = useState<Line | null>(null);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!doc || !drop || !layer) {
      setLine(null);
      return;
    }

    const origin = layer.getBoundingClientRect();
    const rectOf = (id: string): DOMRect | null =>
      doc.querySelector(`[data-vpb-node-id="${id}"]`)?.getBoundingClientRect() ?? null;

    const siblings = childrenOf(tree, drop.parentId);
    const before = drop.index > 0 ? rectOf(siblings[drop.index - 1]?.id ?? '') : null;
    const after = rectOf(siblings[drop.index]?.id ?? '');
    const parentRect =
      drop.parentId === tree.root ? doc.body.getBoundingClientRect() : rectOf(drop.parentId);
    const box = before ?? after ?? parentRect;
    if (!box) {
      setLine(null);
      return;
    }

    // A horizontal bar at the boundary: below the previous child, else above the
    // next, else at the top of an empty container.
    const top = before ? before.bottom : after ? after.top : box.top;
    setLine({
      left: box.left - origin.left,
      top: top - origin.top - THICKNESS / 2,
      width: box.width,
      height: THICKNESS,
    });
  }, [doc, tree, drop]);

  if (!drop) return null;

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      <div
        data-vpb-drop-parent={drop.parentId}
        data-vpb-drop-index={String(drop.index)}
        className="absolute rounded-full"
        style={{
          left: line?.left ?? 0,
          top: line?.top ?? 0,
          width: line?.width ?? 0,
          height: line?.height ?? THICKNESS,
          backgroundColor: 'var(--vpb-color-selection)',
        }}
      />
    </div>
  );
}
