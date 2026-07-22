/**
 * PHASE E5 — snap geometry + the machine's use of it (the headless brain).
 *
 * `snapGuides` decides WHICH line a resize lands on and what guide explains it;
 * `resizeMachine` decides when that applies and lets the size floor overrule it.
 * Pure, no DOM, so this set runs against the `interaction` project alone — one
 * `--project` per file, as every E2/E3 set does.
 *
 * Each mutation is a way snapping looks alive while being wrong: a magnet that
 * never lets go, a centre that moves at the wrong rate, a guide drawn beside the
 * line it claims, an aspect lock quietly broken by the snap that was supposed to
 * yield to it.
 *
 * Every `find` is a SINGLE line — no `\n` — so the patterns match under LF or CRLF.
 */
export default {
  name: 'E5 — snap geometry + machine',
  testCommand: 'pnpm vitest run --project interaction --silent',
  mutations: [
    /* ---- snapGuides: which line, and how far ---------------------------- */
    {
      // The threshold is what makes snapping optional. Drop it and EVERY line in
      // the container captures the edge, so no size between neighbours is reachable.
      name: 'the snap threshold is ignored, so every line captures',
      file: 'packages/interaction/src/snapGuides.ts',
      find: '      if (gap > threshold) continue;',
      replace: '',
    },
    {
      // The centre moves half as fast as the edge, so closing its gap costs twice
      // the width. Correct it 1:1 and a centre snap always lands short.
      name: 'a centre snap corrects by the gap instead of twice the gap',
      file: 'packages/interaction/src/snapGuides.ts',
      find: '    const centre = 2 * (candidate.position - start);',
      replace: '    const centre = candidate.position - start;',
    },
    {
      // The nearest line wins. Take the last match instead and the result depends on
      // the order rects happened to be collected in — a magnet that jumps.
      name: 'the furthest line wins instead of the nearest',
      file: 'packages/interaction/src/snapGuides.ts',
      find: '  if (next.gap !== best.gap) return next.gap < best.gap;',
      replace: '  if (next.gap !== best.gap) return next.gap > best.gap;',
    },
    {
      // The two axes each pick their own line. Match the y candidates against the x
      // geometry and a corner drag aligns its bottom to a vertical line.
      name: 'both axes are resolved against the same axis',
      file: 'packages/interaction/src/snapGuides.ts',
      find: "  const y = nearest(origin, proposed, candidates, 'y', options.threshold);",
      replace: "  const y = nearest(origin, proposed, candidates, 'x', options.threshold);",
    },
    {
      // A line at or behind the box's pinned origin cannot be reached without
      // inverting the box. Accept it and a resize collapses to nothing.
      name: 'a line the box would have to invert to reach is accepted',
      file: 'packages/interaction/src/snapGuides.ts',
      find: '      if (next <= 0) continue;',
      replace: '',
    },
    {
      // The guide marks the line that captured the edge. Report the box's own edge
      // and the guide is drawn beside the thing it claims alignment with.
      name: 'the guide is drawn on the box edge, not the captured line',
      file: 'packages/interaction/src/snapGuides.ts',
      find: '    position: candidate.position,',
      replace: '    position: boxStart,',
    },
    {
      // Under the lock only the DRIVEN axis may snap. Fall through to the free path
      // and both axes snap independently, so the ratio the user asked for is quietly
      // broken by the feature that was supposed to yield to it.
      name: 'the aspect lock is ignored and both axes snap freely',
      file: 'packages/interaction/src/snapGuides.ts',
      find: '  if (ratio !== undefined) {',
      replace: '  if (false) {',
    },
    {
      // The non-driven axis is DERIVED from the ratio, which is what keeps the ratio
      // exact. Leave it at what the pointer named and a locked side-grip resize
      // distorts the box on the axis it does not drive.
      name: 'the locked resize stops deriving the other axis from the ratio',
      file: 'packages/interaction/src/snapGuides.ts',
      find: '        : { width: hit.extent * ratio, height: hit.extent };',
      replace: '        : { width: proposed.width, height: hit.extent };',
    },

    /* ---- resizeMachine: when snapping applies --------------------------- */
    {
      // The floor is applied AFTER the snap, so a line below it cannot shrink a box
      // away. Clamp before and the snap has the last word instead.
      name: 'the size floor no longer overrules a snap below it',
      file: 'packages/interaction/src/resizeMachine.ts',
      find: '        width: Math.max(snapped.size.width, options.minWidth),',
      replace: '        width: snapped.size.width,',
    },
    {
      // A guide claims the edge IS on the line. Keep one the floor overrode and the
      // overlay reports an alignment the box does not have.
      name: 'a guide survives the clamp that overrode its snap',
      file: 'packages/interaction/src/resizeMachine.ts',
      find: '      const heldWidth = clamped.width === snapped.size.width;',
      replace: '      const heldWidth = true;',
    },
  ],
};
