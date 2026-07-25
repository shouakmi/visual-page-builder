/**
 * PHASE E2 — the app drag: DOM adapter + pointer wiring.
 *
 * The parts that read the page and drive the pointer, now verified against a
 * STUBBED layout (jsdom lays nothing out, so the tests hand these known rects and
 * hit-tests). `resolveDrop` turns a pointer into a drop; `Canvas` captures the
 * pointer, shows the indicator, and cancels on Escape. Each mutation is a way the
 * drag looks alive while landing wrong — the axis misread that the integration test
 * actually caught, a validity guard dropped, capture never taken.
 */
export default {
  name: 'E2 — app drag (adapter + wiring)',
  testCommand: 'pnpm vitest run --project web --silent',
  mutations: [
    /* ---- resolveDrop: reading the page --------------------------------- */
    {
      // `flex-direction` is `row` by default even on a block container, so the axis
      // is horizontal ONLY when the box is really a flex row. Drop the display check
      // and every vertical stack is measured along x — the bug the drag test caught.
      name: 'drop axis ignores display, trusting flex-direction alone',
      file: 'apps/web/src/resolveDrop.ts',
      find: "  return isFlex && isRow ? 'horizontal' : 'vertical';",
      replace: "  return isRow ? 'horizontal' : 'vertical';",
    },
    {
      // Never drop INTO a container: an empty section can no longer receive a node.
      name: 'container drops are disabled',
      file: 'apps/web/src/resolveDrop.ts',
      find: '  const into = overId !== draggedId && canDropNode(tree, registry, draggedId, overId);',
      replace: '  const into = false;',
    },
    {
      // The validity guard is what turns an illegal target into "no drop". Remove it
      // and the adapter reports drops core would refuse.
      name: 'the drop validity guard is removed',
      file: 'apps/web/src/resolveDrop.ts',
      find: '  if (!canDropNode(tree, registry, draggedId, parentId)) return null;',
      replace: '  if (false) return null;',
    },

    /* ---- Canvas: the pointer wiring ------------------------------------ */
    {
      // No pointer capture means the drag stalls the moment the cursor leaves the
      // iframe — AUDIT §4.1, restored.
      name: 'the drag never captures the pointer',
      file: 'apps/web/src/Canvas.tsx',
      find: '      if (pointerId !== null) root.setPointerCapture(pointerId);',
      replace: '      if (false) root.setPointerCapture(pointerId);',
    },
    {
      // The drop indicator never updates, so the user drags blind.
      name: 'the drop indicator target is never set',
      file: 'apps/web/src/Canvas.tsx',
      find: '      if (drag.isDragging()) setDropHint(drop);',
      replace: '      if (false) setDropHint(drop);',
    },
    {
      // Escape must revert. Committing instead makes the half-finished move final.
      name: 'escape commits the drag instead of cancelling it',
      file: 'apps/web/src/Canvas.tsx',
      find: "      if (event.key === 'Escape') drag.cancel();",
      replace: "      if (event.key === 'Escape') drag.up();",
    },
  ],
};
