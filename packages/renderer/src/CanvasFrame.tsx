import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * THE CANVAS — a page rendered in an iframe that cannot run code.
 *
 * An iframe at all because the page being built has its own CSS reset, its own
 * font sizes, and its own cascade; rendering it inline would let the editor's
 * stylesheet leak into the user's design and the user's into the editor's. It is
 * also the only way `@media` works honestly: the frame is resized and the real
 * media queries fire, rather than the canvas simulating a viewport it does not
 * have.
 *
 * ───────────────────────── THE SANDBOX ─────────────────────────
 *
 * AUDIT §4.5: the prototype's iframe "is created via `doc.write` **from the
 * parent**, making it **same-origin** — it has full access to the editor's
 * `localStorage` and DOM. It carries no `sandbox` attribute." And §4.6: it
 * injected `<script>${project.js}</script>` and rewrote the document on every
 * click, so that script re-ran constantly, with the editor's origin.
 *
 * `sandbox="allow-same-origin"` — and deliberately NOT `allow-scripts`.
 *
 * The pair is the whole design, and neither half is optional:
 *
 *   `allow-same-origin` keeps the frame on our origin, which is what lets the
 *   parent reach `contentDocument` and portal React into it. That is how the
 *   canvas gets rendered without `doc.write`.
 *
 *   Omitting `allow-scripts` means NOTHING inside the frame executes — not an
 *   injected `<script>`, not an `onerror` on a broken image, not a
 *   `javascript:` URL that slipped past a check. React does not need it: the
 *   PARENT runs the reconciler and writes DOM into the frame; the frame is only
 *   a document.
 *
 * Those two together are safe in a way either alone is not. `allow-same-origin`
 * WITH `allow-scripts` is famously no sandbox at all — content can reach up and
 * remove the sandbox attribute from its own frame. Without `allow-scripts` there
 * is nothing to do the reaching. And a frame with neither is opaque to the
 * parent, which would force us back to `doc.write` or `srcdoc` — i.e. back to
 * §4.6.
 *
 * The cost, stated: the user's own `<script>` (project JS, Phase K) will not run
 * HERE. That is correct for an editing surface — user JS rewriting the DOM under
 * the reconciler is a bug, not a feature — and a Preview that does run it belongs
 * in a frame with `allow-scripts` and NO `allow-same-origin`, which is the exact
 * inverse of this one and must never be this one.
 */

export interface CanvasFrameProps {
  /**
   * The compiled stylesheet for the page. From `compileStyleSheet` — the same
   * function the exporter calls, which is what makes the canvas WYSIWYG.
   */
  readonly css: string;
  /** The rendered page. Usually a `<RenderTree>`. */
  readonly children: ReactNode;
  /** Accessible name for the frame. */
  readonly title: string;
  /** Styles the frame element itself — the device width lives here. */
  readonly className?: string;
  /** Called once the frame's document exists, for Phase E's event wiring. */
  readonly onReady?: (doc: Document) => void;
}

/** Everything inside is the user's design, so the frame starts with no styling of ours. */
const RESET = 'html,body{margin:0;padding:0}';

export function CanvasFrame({ css, children, title, className, onReady }: CanvasFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<Document | null>(null);

  /**
   * Adopt the frame's document once, after mount.
   *
   * `contentDocument` does not exist until the element is in the tree, so this
   * cannot be read during render. It is state rather than a ref because the
   * portal below has to re-render when it arrives.
   */
  useEffect(() => {
    const frame = ref.current;
    const frameDoc = frame?.contentDocument ?? null;
    if (!frameDoc) return;

    setDoc(frameDoc);
    onReady?.(frameDoc);
    // `onReady` is deliberately not a dependency: re-adopting the document
    // because a caller passed a new closure would remount the whole canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Keep the stylesheet up to date by writing TEXT into one `<style>` element.
   *
   * This is the §4.6 fix on the CSS side. Replacing the element (or the
   * document) on every keystroke would drop the frame's scroll position and
   * restart every in-flight image; setting `textContent` on a node that is
   * already there re-runs the cascade and touches nothing else. The style panel
   * emits one of these per slider frame, so it is the hottest path in the editor.
   */
  useEffect(() => {
    if (!doc) return;

    const style = ensureStyle(doc);
    const next = `${RESET}\n${css}`;
    if (style.textContent !== next) style.textContent = next;
  }, [doc, css]);

  return (
    <iframe
      ref={ref}
      title={title}
      className={className}
      /*
       * `about:blank` rather than srcDoc: it is same-origin, synchronously
       * available after mount, and never parses a string we built — so there is
       * no markup for content to escape out of, and nothing to re-parse when the
       * page changes.
       */
      src="about:blank"
      sandbox="allow-same-origin"
    >
      {doc && createPortal(children, doc.body)}
    </iframe>
  );
}

/** The single `<style>` the canvas owns. Created once, then only written to. */
function ensureStyle(doc: Document): HTMLStyleElement {
  const existing = doc.head.querySelector<HTMLStyleElement>('style[data-vpb-canvas]');
  if (existing) return existing;

  const style = doc.createElement('style');
  style.setAttribute('data-vpb-canvas', '');
  doc.head.append(style);
  return style;
}
