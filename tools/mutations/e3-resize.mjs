/**
 * PHASE E3 — resize geometry + machine (the headless brain).
 *
 * `resizeSize` decides how big, `resizeMachine` decides when. Pure, no DOM, so this
 * set runs against the `interaction` project alone — the same scoping every E2 set
 * uses (one `--project` per file). Each mutation is a way a resize looks alive while
 * landing wrong: the wrong edge grows, the untouched axis moves, a box shrinks past
 * the floor, the aspect lock distorts, a click on a handle commits as an edit.
 *
 * Every `find` is a SINGLE line — no `\n` — so the patterns match whether the
 * working tree has LF or CRLF endings (`.gitattributes` pins LF, but the patterns do
 * not depend on it).
 */
export default {
  name: 'E3 — resize geometry + machine',
  testCommand: 'pnpm vitest run --project interaction --silent',
  mutations: [
    /* ---- resizeGeometry: how big -------------------------------------- */
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

    /* ---- resizeMachine: when ------------------------------------------ */
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
      // reverts on release — the size never reaches history. (`{ type: 'commit' }`
      // is unique to the `up` case, so this one line is unambiguous.)
      name: 'release no longer commits the resize',
      file: 'packages/interaction/src/resizeMachine.ts',
      find: "        intent: state.phase === 'resizing' ? { type: 'commit' } : { type: 'none' },",
      replace: "        intent: { type: 'none' },",
    },
    {
      // Escape must revert the preview. Short-circuit the cancel case to a no-op and
      // Escape leaves the half-finished resize on screen, uncommitted and stuck.
      name: 'escape no longer cancels the resize',
      file: 'packages/interaction/src/resizeMachine.ts',
      find: "    case 'cancel':",
      replace: "    case 'cancel':\n      return { state, intent: { type: 'none' } };",
    },
  ],
};
