import { compileStyleSheet, createBuiltinRegistry, getBreakpoint, rootNode } from '@vpb/core';
import { CanvasFrame, RenderChildren, classNameFor, createBuiltinRenderers } from '@vpb/renderer';
import { activePage, type EditorState, type EditorStore } from '@vpb/state';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

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

  return (
    <div className="flex h-full justify-center overflow-auto bg-surface-sunken p-6">
      <div
        className="h-full w-full transition-[max-width] duration-150"
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
        >
          <RenderChildren tree={page.tree} env={env} />
        </CanvasFrame>
      </div>
    </div>
  );
}

/** The breakpoint's own max-width, or undefined at base (which is unconstrained). */
function frameWidth(present: EditorState): number | undefined {
  const breakpoint = getBreakpoint(present.project.breakpoints, present.context.activeBreakpointId);
  return breakpoint?.media?.maxWidth ?? undefined;
}
