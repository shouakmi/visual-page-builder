import {
  compileStyleSheet,
  createBuiltinRegistry,
  createIdFactory,
  getBreakpoint,
  rootNode,
  type NodeId,
} from '@vpb/core';
import { CanvasFrame, RenderChildren, classNameFor, createBuiltinRenderers } from '@vpb/renderer';
import type { Drop } from '@vpb/interaction';
import { activePage, type EditorState, type EditorStore } from '@vpb/state';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import { DropIndicator } from './DropIndicator.tsx';
import { createDragController } from './dragController.ts';
import { createResizeController } from './resizeController.ts';
import { resolveDrop } from './resolveDrop.ts';
import { ResizeHandles } from './ResizeHandles.tsx';
import { SelectionLayer } from './SelectionLayer.tsx';

/**
 * The canvas: the active page, compiled and rendered.
 *
 * This is where the phases meet. The document comes from `@vpb/state`'s store
 * (C), the CSS from core's compiler (D1) — **the same function Phase I's
 * exporter will call** — and the markup from `@vpb/renderer` (D2), inside a
 * frame that cannot run code (D3).
 *
 * It reads `present`, not `committed`: the difference between them is the live
 * drag, and the canvas is what a drag is previewing.
 */

/**
 * Built once for the lifetime of the app.
 *
 * Both are values a plugin extends (Phase K), so they are not module constants
 * in their own packages — but this host has exactly one of each, and rebuilding
 * them per render would hand `RenderTree` a new `env` every time and defeat the
 * memoisation the reconciler depends on.
 */
const registry = createBuiltinRegistry();
const renderers = createBuiltinRenderers();

export interface CanvasProps {
  readonly store: StoreApi<EditorStore>;
}

export function Canvas({ store }: CanvasProps) {
  const present = useStore(store, (state) => state.present);
  const page = activePage(present);

  /**
   * Recompiled when the stylesheet or the page changes, not on every render.
   *
   * The page's own nodes only: classes are project-wide, but another page's
   * node rules are dead weight here exactly as they would be in the export.
   */
  const css = useMemo(
    () =>
      compileStyleSheet(present.project.styles, present.project.breakpoints, {
        nodes: new Set(page.tree.nodes.keys()),
      }),
    [present.project.styles, present.project.breakpoints, page.tree],
  );

  const env = useMemo(
    () => ({ registry, renderers, assets: present.project.assets }),
    [present.project.assets],
  );

  /**
   * The frame is sized to the active breakpoint so the REAL media queries fire.
   *
   * The alternative — simulating a viewport and rewriting the CSS to match — is
   * how a canvas starts disagreeing with the export. Here the browser does the
   * matching, against the same stylesheet the user downloads.
   */
  const maxWidth = frameWidth(present);

  /**
   * The frame's document, once it exists. Selection is wired to it rather than to
   * the iframe element because the click happens INSIDE the frame; `CanvasFrame`
   * hands the document over exactly for this (its `onReady` comment names Phase E).
   */
  const [frameDoc, setFrameDoc] = useState<Document | null>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  /** The gap a release would drop into, shown as the drop indicator. */
  const [dropHint, setDropHint] = useState<Drop | null>(null);

  /** The drag machine wired to the store. Rebuilt only if the store changes. */
  const drag = useMemo(
    () =>
      createDragController(store, {
        onDraggingChange: (isDragging) => {
          setDragging(isDragging);
          if (!isDragging) setDropHint(null);
        },
      }),
    [store],
  );

  /**
   * The resize machine wired to the store. Its own `IdFactory` mints the one rule
   * id a gesture may need, minted fresh per gesture inside the controller.
   */
  const resize = useMemo(
    () => createResizeController(store, { ids: createIdFactory(), onResizingChange: setResizing }),
    [store],
  );

  /**
   * Live values for the pointer handlers, so the listeners bind ONCE per frame
   * document rather than re-attaching on every edit (which would drop an in-flight
   * drag). `treeRef` is what `resolveDrop` measures against; `draggedIdRef` is the
   * node the press armed; `pointerIdRef` is the pointer to capture for the drag.
   */
  const treeRef = useRef(page.tree);
  treeRef.current = page.tree;
  const draggedIdRef = useRef<NodeId | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  /**
   * Click to select, press-and-drag to move. The overlay above the frame is
   * `pointer-events-none`, so the press lands in the frame and these listeners —
   * attached by the parent, allowed under `allow-same-origin` — drive both.
   *
   * A press selects the nearest handle up from the target (so clicking the text
   * inside a heading selects the heading; a bare-body press clears) AND arms a drag
   * on that node. The drag only begins once the pointer crosses the controller's
   * threshold, so a plain click never moves anything.
   */
  useEffect(() => {
    if (!frameDoc) return;

    let armed = false;

    const onPointerDown = (event: PointerEvent) => {
      // Not `instanceof Element`: the frame is same-origin, so React creates these
      // nodes in the FRAME's realm, and a parent-realm `instanceof` check is false
      // for every one of them. `closest` is a plain method on any Element, realm
      // or not, so the hit-test goes through it instead.
      const target = event.target as Element | null;
      const element = target?.closest('[data-vpb-node-id]') ?? null;
      if (!element) {
        store.getState().clearSelection();
        return;
      }
      const id = element.getAttribute('data-vpb-node-id') as NodeId;
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        store.getState().extendSelection([id]);
      } else {
        store.getState().select([id]);
      }
      armed = true;
      draggedIdRef.current = id;
      pointerIdRef.current = event.pointerId;
      drag.down(id, { x: event.clientX, y: event.clientY });
    };

    /*
     * The DECISION (threshold, preview, commit) lives in the tested controller and
     * `resolveDrop`; this only measures a pointer into a drop and shows it. Pointer
     * capture (below) keeps these frame-document events flowing even when the
     * pointer leaves the iframe — the ⚠️ browser-pending behaviour to confirm.
     */
    const onPointerMove = (event: PointerEvent) => {
      if (!armed) return;
      const pointer = { x: event.clientX, y: event.clientY };
      const draggedId = draggedIdRef.current;
      const drop =
        drag.isDragging() && draggedId
          ? resolveDrop({ doc: frameDoc, tree: treeRef.current, registry, draggedId, pointer })
          : null;
      drag.move(pointer, drop);
      if (drag.isDragging()) setDropHint(drop);
    };

    const onPointerUp = () => {
      if (!armed) return;
      armed = false;
      pointerIdRef.current = null;
      drag.up();
    };

    frameDoc.addEventListener('pointerdown', onPointerDown);
    frameDoc.addEventListener('pointermove', onPointerMove);
    frameDoc.addEventListener('pointerup', onPointerUp);
    return () => {
      frameDoc.removeEventListener('pointerdown', onPointerDown);
      frameDoc.removeEventListener('pointermove', onPointerMove);
      frameDoc.removeEventListener('pointerup', onPointerUp);
    };
  }, [frameDoc, store, drag]);

  /** Escape cancels an in-flight drag — on the parent document, where focus lives. */
  useEffect(() => {
    if (!dragging) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') drag.cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dragging, drag]);

  /** Escape cancels an in-flight resize too, reverting the previewed size. */
  useEffect(() => {
    if (!resizing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') resize.cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [resizing, resize]);

  /**
   * Capture the pointer for the drag, on the FRAME's root element — it received the
   * `pointerdown`, so it is the only element allowed to capture that pointer. This
   * is what keeps `pointermove`/`pointerup` arriving at the frame document once the
   * cursor leaves the iframe, and it is the §4.1 fix: the prototype's drag stalled
   * the instant the pointer crossed into the frame. `try/catch` because a pointer
   * can already be gone (a synthetic event, a release that raced the effect), and
   * the drag must not throw on the way up. ⚠️ Verify in a real browser.
   */
  useEffect(() => {
    if (!dragging || !frameDoc) return;
    const root = frameDoc.documentElement;
    const pointerId = pointerIdRef.current;
    try {
      if (pointerId !== null) root.setPointerCapture(pointerId);
    } catch {
      // The pointer is no longer capturable; the drag still works while it is over
      // the frame, which is the common case.
    }
    return () => {
      try {
        if (pointerId !== null) root.releasePointerCapture(pointerId);
      } catch {
        // Already released (e.g. by pointerup); nothing to do.
      }
    };
  }, [dragging, frameDoc]);

  return (
    <div className="flex h-full justify-center overflow-auto bg-surface-sunken p-6">
      <div
        className="relative h-full w-full transition-[max-width] duration-150"
        style={maxWidth === undefined ? undefined : { maxWidth: `${maxWidth}px` }}
      >
        {/*
          The page's root node IS the frame's body: its children render into it
          and its class lands on it. Rendering the root itself would nest a
          <body> inside a <body>, which the browser refuses -- and mapping it to
          some other tag would make the canvas disagree with the export, which is
          the one thing this phase exists to prevent.
        */}
        <CanvasFrame
          css={css}
          title={`${page.name} — page canvas`}
          className="h-full w-full rounded-md border border-border bg-white shadow-sm"
          bodyClassName={classNameFor(rootNode(page.tree))}
          onReady={setFrameDoc}
        >
          <RenderChildren tree={page.tree} env={env} />
        </CanvasFrame>
        <SelectionLayer store={store} doc={frameDoc} />
        {/*
          Resize grips sit over the selection. Hidden during a structural drag —
          the box is moving then, and a resize is a different gesture on a settled
          selection. A grip's own `pointerdown` stops propagation, so grabbing one
          starts a resize instead of the drag a body press would.
        */}
        {!dragging && <ResizeHandles store={store} doc={frameDoc} controller={resize} />}
        <DropIndicator doc={frameDoc} tree={page.tree} drop={dropHint} />
        {dragging && (
          /*
            The drag shield. `pointer-events-none` so it does not intercept the
            frame-document events the drag relies on — pointer CAPTURE (above), not
            the shield, is what keeps those events flowing off the iframe. The shield
            is the visual layer: it shows the grabbing cursor for the whole drag,
            including over the editor chrome, where the frame's cursor cannot reach.
          */
          <div className="absolute inset-0 z-10 cursor-grabbing" aria-hidden />
        )}
      </div>
    </div>
  );
}

/** The breakpoint's own max-width, or undefined at base (which is unconstrained). */
function frameWidth(present: EditorState): number | undefined {
  const breakpoint = getBreakpoint(present.project.breakpoints, present.context.activeBreakpointId);
  return breakpoint?.media?.maxWidth ?? undefined;
}
