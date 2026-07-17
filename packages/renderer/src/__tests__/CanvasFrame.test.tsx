import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CanvasFrame } from '../CanvasFrame.tsx';

/** The frame element, and the document it hosts. */
function mount(ui: Parameters<typeof render>[0]) {
  const result = render(ui);
  const frame = result.container.querySelector('iframe');
  if (!frame) throw new Error('no iframe rendered');
  return { ...result, frame, doc: frame.contentDocument };
}

/* -------------------------------------------------------------------------- */
/* AUDIT §4.5 — the prototype's iframe was same-origin and unsandboxed         */
/* -------------------------------------------------------------------------- */

describe('the sandbox', () => {
  it('is sandboxed at all — the prototype carried no sandbox attribute', () => {
    const { frame } = mount(
      <CanvasFrame css="" title="Canvas">
        <div />
      </CanvasFrame>,
    );
    expect(frame.hasAttribute('sandbox')).toBe(true);
  });

  /**
   * THE PAIRING, AND WHY EACH HALF IS LOAD-BEARING.
   *
   * `allow-same-origin` is what lets the parent reach `contentDocument` and
   * portal into it — without it we are back to `doc.write` (§4.6).
   *
   * Omitting `allow-scripts` is what makes that safe: nothing inside executes, so
   * an injected `<script>`, an `onerror`, or a `javascript:` URL that slipped a
   * check is inert. React does not need scripts in the frame — the PARENT runs
   * the reconciler and writes DOM in.
   *
   * The combination `allow-same-origin allow-scripts` is famously NOT a sandbox:
   * content can reach up and remove the attribute from its own frame. That is the
   * assertion below, and it is the one that must never be "relaxed" to fix a bug.
   */
  it('allows same-origin but NOT scripts', () => {
    const { frame } = mount(
      <CanvasFrame css="" title="Canvas">
        <div />
      </CanvasFrame>,
    );
    const sandbox = frame.getAttribute('sandbox') ?? '';

    expect(sandbox.split(/\s+/)).toContain('allow-same-origin');
    expect(sandbox).not.toContain('allow-scripts');
  });

  it('has an accessible name', () => {
    const { frame } = mount(
      <CanvasFrame css="" title="Page canvas">
        <div />
      </CanvasFrame>,
    );
    expect(frame.getAttribute('title')).toBe('Page canvas');
  });
});

/* -------------------------------------------------------------------------- */
/* AUDIT §4.6 — the document was rewritten on every state change               */
/* -------------------------------------------------------------------------- */

describe('rendering into the frame', () => {
  it('portals the page into the frame document, not the parent', () => {
    const { doc, container } = mount(
      <CanvasFrame css="" title="Canvas">
        <p className="page">Hello</p>
      </CanvasFrame>,
    );

    expect(doc?.body.querySelector('.page')?.textContent).toBe('Hello');
    // The editor's own document is not where the user's page lives.
    expect(container.querySelector('.page')).toBeNull();
  });

  it('injects the compiled CSS into the frame head', () => {
    const { doc } = mount(
      <CanvasFrame css=".btn { color: red; }" title="Canvas">
        <div />
      </CanvasFrame>,
    );

    const style = doc?.head.querySelector('style[data-vpb-canvas]');
    expect(style?.textContent).toContain('.btn { color: red; }');
  });

  it('resets the frame margin, since everything inside is the user design', () => {
    const { doc } = mount(
      <CanvasFrame css="" title="Canvas">
        <div />
      </CanvasFrame>,
    );
    expect(doc?.head.querySelector('style[data-vpb-canvas]')?.textContent).toContain('margin:0');
  });

  /**
   * THE §4.6 FIX. The prototype ran doc.open/write/close on every state change,
   * and since `select()` mutated state, a click rebuilt the document — losing
   * scroll, focus, and every in-flight request.
   *
   * Asserted on element IDENTITY: the same objects must survive an edit, not
   * merely equal ones.
   */
  it('updates content without rebuilding the document', () => {
    const { doc, rerender } = mount(
      <CanvasFrame css="" title="Canvas">
        <p id="a">before</p>
      </CanvasFrame>,
    );

    const body = doc?.body;
    const paragraph = doc?.getElementById('a');

    rerender(
      <CanvasFrame css="" title="Canvas">
        <p id="a">after</p>
      </CanvasFrame>,
    );

    expect(doc?.getElementById('a')?.textContent).toBe('after');
    expect(doc?.body).toBe(body);
    expect(doc?.getElementById('a')).toBe(paragraph);
  });

  /**
   * The style panel emits one of these per slider frame, so it is the editor's
   * hottest path. Replacing the element would drop scroll and restart images;
   * writing textContent re-runs the cascade and touches nothing else.
   */
  it('updates the CSS by writing text into the SAME style element', () => {
    const { doc, rerender } = mount(
      <CanvasFrame css=".btn { color: red; }" title="Canvas">
        <div />
      </CanvasFrame>,
    );

    const style = doc?.head.querySelector('style[data-vpb-canvas]');

    rerender(
      <CanvasFrame css=".btn { color: blue; }" title="Canvas">
        <div />
      </CanvasFrame>,
    );

    expect(doc?.head.querySelector('style[data-vpb-canvas]')).toBe(style);
    expect(style?.textContent).toContain('color: blue');
    expect(style?.textContent).not.toContain('color: red');
  });

  it('keeps exactly one canvas style element across updates', () => {
    const { doc, rerender } = mount(
      <CanvasFrame css="a{}" title="Canvas">
        <div />
      </CanvasFrame>,
    );

    for (const css of ['b{}', 'c{}', 'd{}']) {
      rerender(
        <CanvasFrame css={css} title="Canvas">
          <div />
        </CanvasFrame>,
      );
    }

    expect(doc?.head.querySelectorAll('style[data-vpb-canvas]')).toHaveLength(1);
  });

  it('keeps the page mounted while only the CSS changes', () => {
    const { doc, rerender } = mount(
      <CanvasFrame css="a{}" title="Canvas">
        <p id="a">text</p>
      </CanvasFrame>,
    );
    const paragraph = doc?.getElementById('a');

    rerender(
      <CanvasFrame css="b{}" title="Canvas">
        <p id="a">text</p>
      </CanvasFrame>,
    );

    expect(doc?.getElementById('a')).toBe(paragraph);
  });
});

describe('onReady', () => {
  it('hands the frame document to the host once — Phase E wires events here', () => {
    const seen: Document[] = [];
    const { doc, rerender } = mount(
      <CanvasFrame css="" title="Canvas" onReady={(d) => seen.push(d)}>
        <div />
      </CanvasFrame>,
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(doc);

    // A new closure from the host must not re-adopt the document: that would
    // remount the canvas on every parent render.
    rerender(
      <CanvasFrame css="" title="Canvas" onReady={(d) => seen.push(d)}>
        <div />
      </CanvasFrame>,
    );
    expect(seen).toHaveLength(1);
  });
});
