/**
 * PHASE E5 — the app slice: the snap adapter, the controller seam, the guides.
 *
 * `snapTargets` reads the page, `resizeController` carries the lines to the machine
 * and the guides back out, `SnapGuides` draws them. Verified against a STUBBED
 * layout because jsdom lays nothing out. Runs against the `web` project alone.
 *
 * The first mutation is the one that matters most: it does not corrupt snapping, it
 * DISCONNECTS it. A feature wired to nothing still renders, still typechecks, and
 * still passes any test that only exercises the parts either side of the cut.
 *
 * Every `find` is a SINGLE line — no `\n` — so the patterns match under LF or CRLF.
 */
export default {
  name: 'E5 — snap adapter + controller + guides',
  testCommand: 'pnpm vitest run --project web --silent',
  mutations: [
    {
      // The controller asks the host what the node can align to. Stop asking and
      // snapping is silently dead everywhere while every unit below still passes.
      name: 'the controller never asks what the node can align to',
      file: 'apps/web/src/resizeController.ts',
      find: '      const snap = nodeId !== null ? (options.snapFor?.(nodeId) ?? null) : null;',
      replace: '      const snap = null;',
    },
    {
      // Guides are emptied when the gesture ends. Skip it and the lines stay on
      // screen after release and after Escape, describing an alignment nothing has.
      name: 'the guides are not cleared when the gesture ends',
      file: 'apps/web/src/resizeController.ts',
      find: "    if (intent.type === 'commit' || intent.type === 'cancel') emitGuides(NO_GUIDES);",
      replace: '',
    },
    {
      // The resized node is excluded from its own candidates. Include it and its own
      // edges sit zero pixels away, capturing on every move: the box cannot resize.
      name: 'the resized node offers its own edges as targets',
      file: 'apps/web/src/snapTargets.ts',
      find: '    if (sibling.id === nodeId) continue;',
      replace: '',
    },
    {
      // Candidates come from the SIBLINGS. Read the node's own children instead and
      // a container snaps to things that move because it resized.
      name: 'the candidates come from the descendants instead of the siblings',
      file: 'apps/web/src/snapTargets.ts',
      find: '  for (const sibling of childrenOf(tree, parentId)) {',
      replace: '  for (const sibling of childrenOf(tree, nodeId)) {',
    },
    {
      // The container's own edges are candidates — "fill the parent" lives nowhere
      // else. Drop them and the commonest alignment of all stops working.
      name: 'the container offers no lines of its own',
      file: 'apps/web/src/snapTargets.ts',
      find: '  if (container) rects.push(container.getBoundingClientRect());',
      replace: '',
    },
    {
      // The origin is measured fresh from the resized element. Report a fixed zero
      // and every candidate is compared against a box that is not where it is.
      name: 'the box origin is reported as the page origin',
      file: 'apps/web/src/snapTargets.ts',
      find: '    boxOrigin: { x: rect.left, y: rect.top },',
      replace: '    boxOrigin: { x: 0, y: 0 },',
    },
    {
      // An `x` guide is a VERTICAL line. Swap the axis branch and every guide is
      // drawn across the edge it is supposed to mark.
      name: 'the guide is drawn perpendicular to the edge it marks',
      file: 'apps/web/src/SnapGuides.tsx',
      find: "  if (guide.axis === 'x') {",
      replace: "  if (guide.axis === 'y') {",
    },
  ],
};
