/**
 * PHASE E3 — the app slice: the resize controller + the grips.
 *
 * The store integration (`resizeController`) and the overlay grips (`ResizeHandles`),
 * verified against a STUBBED layout because jsdom lays nothing out. Runs against the
 * `web` project alone. Each mutation is a way the resize looks alive while landing
 * wrong — width without height, a resize that never commits, a mobile resize that
 * writes base. Every `find` is a single line, so LF/CRLF endings do not matter.
 */
export default {
  name: 'E3 — resize controller + grips',
  testCommand: 'pnpm vitest run --project web --silent',
  mutations: [
    {
      // A corner resize sets width AND height as one entry. Drop the height and the
      // box only ever changes width — half a resize.
      name: 'the resize sets width but not height',
      file: 'apps/web/src/resizeController.ts',
      find: "              { property: 'height', value: px(intent.size.height) },",
      replace: '',
    },
    {
      // Release must commit. Swallow the commit and the resize reverts on mouse-up —
      // the size is previewed, then lost.
      name: 'the controller never commits the resize',
      file: 'apps/web/src/resizeController.ts',
      find: '        store.getState().commitPreview();',
      replace: '        void 0;',
    },
    {
      // Escape/invalid must cancel. Commit instead and Escape makes the half-finished
      // size final, the opposite of revert.
      name: 'the controller commits on cancel instead of reverting',
      file: 'apps/web/src/resizeController.ts',
      find: '        store.getState().cancelPreview();',
      replace: '        store.getState().commitPreview();',
    },
    {
      // The resize writes the ACTIVE breakpoint's target. Hardcode base and a resize
      // while emulating mobile writes the base rule — the WYSIWYG hole D4 closed.
      name: 'the resize writes base instead of the active breakpoint',
      file: 'apps/web/src/resizeController.ts',
      find: 'styleTarget(breakpoint)',
      replace: "styleTarget('base')",
    },
    {
      // The start size is the element's real width/height. Swap them and every resize
      // starts from a transposed box, so the very first preview is already wrong.
      name: 'the grabbed start size transposes width and height',
      file: 'apps/web/src/ResizeHandles.tsx',
      find: '    const start: Size = { width: rect.width, height: rect.height };',
      replace: '    const start: Size = { width: rect.height, height: rect.width };',
    },
  ],
};
