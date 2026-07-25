import type { SnapGuide } from '@vpb/interaction';
import { useLayoutEffect, useRef, useState } from 'react';

/**
 * THE SNAP GUIDES — the lines that explain why a resize stopped where it did.
 *
 * The third overlay, after `SelectionLayer` and `DropIndicator`, and it follows
 * their shape exactly: it lives in the EDITOR document over the frame, it is
 * `pointer-events-none` so it never intercepts the gesture drawing it, and it
 * measures its own origin to convert the frame-read coordinates the geometry works
 * in into offsets within the overlay.
 *
 * It decides nothing. A guide is drawn if and only if `snapSize` reported one, so
 * a line on screen always means an edge is genuinely sitting on that line — the
 * overlay cannot invent an alignment, and cannot keep claiming one after the
 * gesture that made it has ended.
 *
 * Its geometry is browser-pending like every rect read: jsdom lays nothing out, so
 * the lines' PIXELS are only right in a real browser. What is verified here is
 * that a line appears per reported guide, on the right axis, and vanishes with the
 * gesture.
 */

export interface SnapGuidesProps {
  readonly guides: readonly SnapGuide[];
}

/** Hairline. A guide marks a position; it should not be thick enough to hide one. */
const THICKNESS = 1;

export function SnapGuides({ guides }: SnapGuidesProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const rect = layer.getBoundingClientRect();
    setOrigin({ left: rect.left, top: rect.top });
  }, [guides]);

  if (guides.length === 0) return null;

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      {guides.map((guide) => (
        <div
          key={`${guide.axis}:${guide.position}:${guide.kind}`}
          data-vpb-snap-axis={guide.axis}
          data-vpb-snap-kind={guide.kind}
          data-vpb-snap-position={String(guide.position)}
          className="absolute"
          style={lineStyle(guide, origin)}
        />
      ))}
    </div>
  );
}

/**
 * An `x` guide is a VERTICAL line — the axis names the coordinate the line is
 * fixed on, not the direction it runs. Getting this backwards draws every guide
 * perpendicular to the edge it is meant to mark.
 */
function lineStyle(guide: SnapGuide, origin: { left: number; top: number }) {
  const colour = 'var(--vpb-color-selection)';

  if (guide.axis === 'x') {
    return {
      left: guide.position - origin.left,
      top: guide.from - origin.top,
      width: THICKNESS,
      height: guide.to - guide.from,
      backgroundColor: colour,
    };
  }

  return {
    left: guide.from - origin.left,
    top: guide.position - origin.top,
    width: guide.to - guide.from,
    height: THICKNESS,
    backgroundColor: colour,
  };
}
