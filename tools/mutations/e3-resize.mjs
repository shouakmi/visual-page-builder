/**
 * PHASE E3 — resize.
 *
 * The same split as drag: a headless brain (`resizeGeometry` how big,
 * `resizeMachine` when) and a thin, browser-pending adapter (`resizeController`
 * wired to the store, `ResizeHandles` the grips). Each mutation is a way a resize
 * looks alive while landing wrong — the wrong edge grows, the untouched axis moves,
 * a box shrinks past the floor, the size never commits, a mobile resize writes base.
 *
 * The set spans three projects, so its `testCommand` runs all three; every mutation
 * is caught by a test that runs the resolved size through the real store or the
 * pure geometry.
 */
export default {
  name: 'E3 — resize (geometry + machine + controller + grips)',
  testCommand: 'pnpm vitest run --project interaction --project state --project web --silent',
  mutations: [
    /* ---- resizeGeometry: how big --------------------------------------- */
    {
      // The floor keeps a box selectable. Drop the clamp and a box drags to zero
      // and past it, into negative width — unclickable, unrecoverable.
      name: 'the minimum-width clamp is removed',
      file: 'packages/interaction/src/resizeGeometry.ts',
      find: '    width: Math.max(width, constraints.minWidth),',
      replace: '    width: width,',
    },
    {
      // The east edge grows as the pointer moves right; the west edge as it moves
      // left. Flip the sign and every horizontal resize runs backwards.
      name: 'the horizontal edge grows the wrong way',
      file: 'packages/interaction/src/resizeGeometry.ts',
      find: '  let width = start.width + hx * delta.x;',
      replace: '  let width = start.width - hx * delta.x;',
    },
    {
      // Height must track the pointer's VERTICAL travel. Read its x and a resize
      // changes height when the pointer moves sideways — nonsense.
      name: 'height reads the wrong pointer axis',
      file: 'packages/interaction/src/resizeGeometry.ts',
      find: '  let height = start.height + vy * delta.y;',
      replace: '  let height = start.height + vy * delta.x;',
    },
    {
      // Aspect lock DIVIDES to hold the ratio (height = width / r). Multiply and the
      // locked box distorts away from its ratio instead of keeping it.
      name: 'the aspect lock multiplies instead of dividing',
      file: 'packages/interaction/src/resizeGeometry.ts',
      find: '    if (hx !== 0) height = width / constraints.aspectRatio;',
      replace: '    if (hx !== 0) height = width * constraints.aspectRatio;',
    },

    /* ---- resizeMachine: when ------------------------------------------- */
    {
      // A grab one pixel short of the threshold must not resize. Loosen `>=` to `>`
      // and a resize exactly at the threshold silently fails to start.
      name: 'the threshold excludes its own boundary',
      file: 'packages/interaction/src/resizeMachine.ts',
      find: 'distance(state.origin, input.point) >= options.threshold',
      replace: 'distance(state.origin, input.point) > options.threshold',
    },
    {
      // Release must commit the previewed size. Drop the commit and every resize
      // reverts on release — the size never reaches history.
      name: 'release no longer commits the resize',
      file: 'packages/interaction/src/resizeMachine.ts',
      find: "        intent: state.phase === 'resizing' ? { type: 'commit' } : { type: 'none' },",
      replace: "        intent: { type: 'none' },",
    },
    {
      // Escape must revert the preview. The `down` case carries the same ternary, so
      // the `RESIZE_IDLE` line disambiguates this as the cancel case specifically.
      name: 'escape no longer cancels the resize',
      file: 'packages/interaction/src/resizeMachine.ts',
      find: "        state: RESIZE_IDLE,\n        intent: state.phase === 'resizing' ? { type: 'cancel' } : { type: 'none' },",
      replace: "        state: RESIZE_IDLE,\n        intent: { type: 'none' },",
    },

    /* ---- setStylePropertiesCommand: one entry -------------------------- */
    {
      // The properties are what make one gesture's key distinct from another's. Drop
      // them and a width-only resize coalesces into a preceding width+height one.
      name: 'the coalesce key forgets which properties are edited',
      file: 'packages/state/src/commands/styleCommands.ts',
      find: '  return `setStyleProperties:${scopeKey(scope)}:${targetKey(target)}:${properties}`;',
      replace: '  return `setStyleProperties:${scopeKey(scope)}:${targetKey(target)}`;',
    },
    {
      // Undoing a resize must UNSET a property it newly added, not leave it. Leave it
      // and undoing a corner resize on an auto-sized box strands one axis pinned.
      name: 'undo does not unset a newly-added property',
      file: 'packages/state/src/commands/styleCommands.ts',
      find: '          value === undefined\n            ? unsetProperty(styles, scope, target, property)',
      replace: '          value === undefined\n            ? styles',
    },

    /* ---- resizeController: the store integration ----------------------- */
    {
      // A corner resize sets width AND height as one entry. Drop the height and the
      // box only ever changes width — half a resize.
      name: 'the resize sets width but not height',
      file: 'apps/web/src/resizeController.ts',
      find: "\n              { property: 'height', value: px(intent.size.height) },",
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

    /* ---- ResizeHandles: the grips ------------------------------------- */
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
