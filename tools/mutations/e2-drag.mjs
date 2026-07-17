/**
 * PHASE E2 — drag geometry.
 *
 * `dropTarget` decides where a drag lands: which parent, which gap. It is pure
 * arithmetic on rectangles, and every way it can be subtly wrong is a way a drag
 * feels broken — a row lands one slot off, a horizontal row reads the wrong axis,
 * a same-parent reorder is decremented in the wrong direction. AUDIT §4.4 shipped
 * exactly this class of off-by-one in `insertNode`. These are those mutations.
 *
 * The composition tests run the returned index through core's real `moveNode`, so
 * an off-by-one that "passes" the pure arithmetic still fails against the tree.
 *
 * The second block is the drag STATE MACHINE — the same headless package, the same
 * test project. A drag is a sequence, and its bugs are sequence bugs: firing before
 * the threshold, committing a click, not reverting on escape.
 */
export default {
  name: 'E2 — drag geometry + machine',
  testCommand: 'pnpm vitest run --project interaction --silent',
  mutations: [
    {
      // Vertical stacks read the pointer's y, horizontal rows its x. Swap them and
      // a column drops by horizontal position — every reorder is nonsense.
      name: 'drop axis reads the wrong pointer coordinate',
      file: 'packages/interaction/src/dropTarget.ts',
      find: "  const along = zone.axis === 'vertical' ? pointer.y : pointer.x;",
      replace: "  const along = zone.axis === 'vertical' ? pointer.x : pointer.y;",
    },
    {
      // "before the pointer" is the whole ordering. Flip the comparison and the
      // index runs backwards: prepends become appends.
      name: 'the before/after comparison is inverted',
      file: 'packages/interaction/src/dropTarget.ts',
      find: '    if (midpoint(child.rect, zone.axis) < along) index += 1;',
      replace: '    if (midpoint(child.rect, zone.axis) > along) index += 1;',
    },
    {
      // Counting two per child instead of one: the index overshoots, and moveNode
      // clamps it to the end — every drop appends.
      name: 'the index counts too fast',
      file: 'packages/interaction/src/dropTarget.ts',
      find: 'index += 1;',
      replace: 'index += 2;',
    },
    {
      // The gap must flip at the child's MIDPOINT, not its top/left edge. Using the
      // edge makes a drop land a row early — you aim between two items and it
      // inserts above the upper one.
      name: 'the boundary is the edge, not the midpoint',
      file: 'packages/interaction/src/dropTarget.ts',
      find: "  return axis === 'vertical' ? rect.top + rect.height / 2 : rect.left + rect.width / 2;",
      replace: "  return axis === 'vertical' ? rect.top : rect.left;",
    },

    /* ---- the drag state machine ---------------------------------------- */
    {
      // A press one pixel short of the threshold must not drag. Loosen `>=` to `>`
      // and a drag exactly at the threshold silently fails to start.
      name: 'the threshold excludes its own boundary',
      file: 'packages/interaction/src/dragMachine.ts',
      find: 'distance(state.origin, input.point) >= options.threshold',
      replace: 'distance(state.origin, input.point) > options.threshold',
    },
    {
      // Invert the threshold and a click becomes a drag while a real drag stalls.
      name: 'the threshold test is inverted',
      file: 'packages/interaction/src/dragMachine.ts',
      find: 'distance(state.origin, input.point) >= options.threshold',
      replace: 'distance(state.origin, input.point) < options.threshold',
    },
    {
      // Release must commit the previewed move. Drop the commit and every drag
      // reverts on release — the move never reaches history.
      name: 'release no longer commits the drag',
      file: 'packages/interaction/src/dragMachine.ts',
      find: "        intent: state.phase === 'dragging' ? { type: 'commit' } : { type: 'none' },",
      replace: "        intent: { type: 'none' },",
    },
    {
      // Escape must revert the preview. Drop the cancel and Escape leaves the
      // half-finished move on screen, uncommitted and unrevertable.
      name: 'escape no longer cancels the drag',
      file: 'packages/interaction/src/dragMachine.ts',
      find: "        state: IDLE,\n        intent: state.phase === 'dragging' ? { type: 'cancel' } : { type: 'none' },",
      replace: "        state: IDLE,\n        intent: { type: 'none' },",
    },
  ],
};
