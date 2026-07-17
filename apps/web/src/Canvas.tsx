import {
  compileStyleSheet,
  createBuiltinRegistry,
  getBreakpoint,
  rootNode,
  type NodeId,
} from '@vpb/core';
import { CanvasFrame, RenderChildren, classNameFor, createBuiltinRenderers } from '@vpb/renderer';
import { activePage, type EditorState, type EditorStore } from '@vpb/state';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

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

  /**
   * Click to select. The overlay above the frame is `pointer-events-none`, so the
   * press lands in the frame and this listener — attached by the parent, which is
   * allowed under `allow-same-origin` — recovers the node from its hit-test handle.
   *
   * Nearest handle up from the target, so clicking the text inside a heading
   * selects the heading. No handle at all means the bare body was hit: clear. Shift
   * or ctrl/cmd extends the selection rather than replacing it (Phase E multi-select).
   */
  useEffect(() => {
    if (!frameDoc) return;

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
    };

    frameDoc.addEventListener('pointerdown', onPointerDown);
    return () => frameDoc.removeEventListener('pointerdown', onPointerDown);
  }, [frameDoc, store]);

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
      </div>
    </div>
  );
}

/** The breakpoint's own max-width, or undefined at base (which is unconstrained). */
function frameWidth(present: EditorState): number | undefined {
  const breakpoint = getBreakpoint(present.project.breakpoints, present.context.activeBreakpointId);
  return breakpoint?.media?.maxWidth ?? undefined;
}
