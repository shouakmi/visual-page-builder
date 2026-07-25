import type { SnapGuide } from '@vpb/interaction';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SnapGuides } from '../SnapGuides.tsx';

/**
 * The overlay decides nothing — it draws exactly the guides it is handed. So what
 * is asserted here is the correspondence: one line per guide, on the axis the
 * guide names, and NOTHING at all when nothing snapped.
 *
 * Pixels are browser-pending as everywhere else in this app (jsdom lays nothing
 * out, so the layer's own origin measures as zero); the structure is not.
 */

function guide(overrides: Partial<SnapGuide> = {}): SnapGuide {
  return { axis: 'x', position: 120, kind: 'edge', from: 0, to: 300, ...overrides };
}

function lines(container: HTMLElement) {
  return [...container.querySelectorAll('[data-vpb-snap-axis]')];
}

describe('the snap guide overlay', () => {
  it('draws one line per reported guide', () => {
    const { container } = render(
      <SnapGuides guides={[guide(), guide({ axis: 'y', position: 80 })]} />,
    );

    expect(lines(container)).toHaveLength(2);
  });

  it('renders nothing when nothing snapped', () => {
    const { container } = render(<SnapGuides guides={[]} />);

    // Not an empty layer — no layer. A guide on screen must always mean an edge is
    // sitting on a line, so between gestures there is nothing to see.
    expect(container).toBeEmptyDOMElement();
  });

  it('draws an x guide as a VERTICAL line and a y guide as a horizontal one', () => {
    const { container } = render(
      <SnapGuides guides={[guide({ from: 0, to: 300 }), guide({ axis: 'y', from: 0, to: 200 })]} />,
    );

    const [vertical, horizontal] = lines(container) as HTMLElement[];

    // The axis names the coordinate the line is FIXED on, so an x guide runs down
    // the page: tall and hairline-thin. Swapping these draws every guide across the
    // edge it is meant to mark.
    expect(vertical?.style.height).toBe('300px');
    expect(vertical?.style.width).toBe('1px');
    expect(horizontal?.style.width).toBe('200px');
    expect(horizontal?.style.height).toBe('1px');
  });

  it('reports the line position it drew, so a guide is traceable to its geometry', () => {
    const { container } = render(
      <SnapGuides guides={[guide({ position: 137, kind: 'center' })]} />,
    );

    const [line] = lines(container) as HTMLElement[];
    expect(line?.getAttribute('data-vpb-snap-position')).toBe('137');
    expect(line?.getAttribute('data-vpb-snap-kind')).toBe('center');
  });

  it('does not intercept the gesture that is drawing it', () => {
    const { container } = render(<SnapGuides guides={[guide()]} />);

    // The resize is driven by a pointer that must keep reaching the grip and the
    // frame beneath — a guide layer that swallowed events would end the gesture it
    // exists to describe.
    expect(container.firstElementChild).toHaveClass('pointer-events-none');
  });
});
