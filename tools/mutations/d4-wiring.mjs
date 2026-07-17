/**
 * PHASE D4 — the app wiring.
 *
 * D1 compiles, D2 renders, D3 sandboxes — each proven in its own package. `Canvas.tsx`
 * is the wiring that connects them, and wiring fails differently from logic: every
 * piece works, and the bug is that the wrong two were joined. Reading `committed`
 * instead of `present` compiles, renders, and passes every other package's suite —
 * the only symptom is that a live drag freezes on screen. These are the mutations
 * that swap one correct wire for another equally-typed one.
 *
 * The set targets `apps/web/src/Canvas.tsx` and runs against the `web` project,
 * which renders the canvas into a jsdom iframe (see apps/web/src/__tests__/Canvas.test.tsx).
 */
export default {
  name: 'D4 — app wiring',
  testCommand: 'pnpm vitest run --project web --silent',
  mutations: [
    /* ---- present vs committed: the live-drag invariant ------------------ */
    {
      // THE ONE THAT MATTERS. `present` is what a drag previews; `committed` is
      // the last state that reached history. They differ exactly during a drag,
      // so this mutation freezes every preview on the canvas — and passes every
      // test that never previews.
      name: 'canvas reads committed instead of present, freezing live previews',
      file: 'apps/web/src/Canvas.tsx',
      find: '  const present = useStore(store, (state) => state.present);',
      replace: '  const present = useStore(store, (state) => state.committed);',
    },

    /* ---- the active page, not merely the first ------------------------- */
    {
      // A project has many pages; the canvas shows the one the user is on. Reading
      // pages[0] renders the home page no matter which tab is open.
      name: 'canvas renders the first page instead of the active page',
      file: 'apps/web/src/Canvas.tsx',
      find: '  const page = activePage(present);',
      replace: '  const page = present.project.pages[0];',
    },

    /* ---- the compiler, and its per-page node filter -------------------- */
    {
      // Without the filter the sheet still compiles — it just carries every other
      // page's node rules too. With an empty filter it drops THIS page's, so the
      // node-scoped rule the fixture sets on its heading vanishes from the frame.
      name: 'per-page node filter dropped from the compile call',
      file: 'apps/web/src/Canvas.tsx',
      find: 'new Set(page.tree.nodes.keys())',
      replace: 'new Set()',
    },
    {
      // The compiled CSS never reaching the frame is the whole WYSIWYG promise,
      // silently unwired: the DOM is right and every rule is missing.
      name: 'compiled CSS never handed to the frame',
      file: 'apps/web/src/Canvas.tsx',
      find: 'css={css}',
      replace: "css={''}",
    },

    /* ---- the page root is the frame body ------------------------------- */
    {
      // The page's root node IS the frame body (RenderChildren renders into it),
      // so its class must land on the body or every page-level rule targets an
      // element that is not there. The page renders perfectly and looks unstyled.
      name: 'page root class dropped from the frame body',
      file: 'apps/web/src/Canvas.tsx',
      find: 'bodyClassName={classNameFor(rootNode(page.tree))}',
      replace: "bodyClassName={''}",
    },

    /* ---- the frame is sized to the active device ----------------------- */
    {
      // The width is computed and then not used: the real media queries never fire
      // because the frame is never narrowed, so the canvas silently shows the
      // desktop layout on every device.
      name: 'computed device width never applied to the frame',
      file: 'apps/web/src/Canvas.tsx',
      find: 'style={maxWidth === undefined ? undefined : { maxWidth: `${maxWidth}px` }}',
      replace: 'style={undefined}',
    },
    {
      // frameWidth stops reading the breakpoint's max-width, so every device is
      // unconstrained — the same "always desktop" bug, one line earlier.
      name: 'frame width always unconstrained',
      file: 'apps/web/src/Canvas.tsx',
      find: '  return breakpoint?.media?.maxWidth ?? undefined;',
      replace: '  return undefined;',
    },
    {
      // The width is read for a fixed breakpoint instead of the active one: switch
      // to Mobile and the frame stays desktop-wide because it never asked which
      // device is selected.
      name: 'frame width ignores the active device',
      file: 'apps/web/src/Canvas.tsx',
      find: 'present.context.activeBreakpointId',
      replace: "'base'",
    },
  ],
};
