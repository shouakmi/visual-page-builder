/**
 * PHASE E1 — selection + overlay.
 *
 * The interaction layer's first slice: click an element and it becomes selected,
 * with a box drawn over it. Three files share the job — the renderer stamps the
 * hit-test handle, `Canvas` maps a click back to a node, `SelectionLayer` draws the
 * box — and each has a way to look right while being subtly wrong. Dropping the
 * handle leaves a page that renders perfectly and cannot be selected. Reading
 * `event.target` instead of walking to the nearest handle selects nothing the
 * moment a component has inner markup. These are those mutations.
 *
 * One set, `web` testCommand: the web selection tests render the REAL renderer, so
 * a regression in the renderer's handle is caught here too, through the click that
 * depends on it.
 */
export default {
  name: 'E1 — selection + overlay',
  testCommand: 'pnpm vitest run --project web --silent',
  mutations: [
    /* ---- the renderer's hit-test handle -------------------------------- */
    {
      // Drop the attribute injection and nothing is addressable: the page renders,
      // every click finds no handle, and selection is dead.
      name: 'renderer stops stamping the node hit-test handle',
      file: 'packages/renderer/src/RenderTree.tsx',
      find: "  return isValidElement(element)\n    ? cloneElement(element as ReactElement<Record<string, unknown>>, { 'data-vpb-node-id': id })\n    : element;",
      replace: '  return element;',
    },

    /* ---- the click → node hit-test ------------------------------------- */
    {
      // `event.target` is whatever was pressed — a decorative span inside a card,
      // the text inside a heading. Only walking up to the nearest handle recovers
      // the node; using the target directly selects nothing when it is not a node.
      name: 'hit-test reads the pressed element instead of its nearest handle',
      file: 'apps/web/src/Canvas.tsx',
      find: "      const element = target?.closest('[data-vpb-node-id]') ?? null;",
      replace: '      const element = target ?? null;',
    },
    {
      // A press on empty canvas must clear. Drop the clear and the previous
      // selection sticks, so the overlay lies about what is selected.
      name: 'pressing empty canvas no longer clears the selection',
      file: 'apps/web/src/Canvas.tsx',
      find: '      if (!element) {\n        store.getState().clearSelection();\n        return;\n      }',
      replace: '      if (!element) {\n        return;\n      }',
    },
    {
      // Shift/ctrl must ADD to the selection. Collapsing it to a plain replace
      // makes multi-select impossible — the model holds a list for nothing.
      name: 'shift-press replaces the selection instead of extending it',
      file: 'apps/web/src/Canvas.tsx',
      find: '        store.getState().extendSelection([id]);',
      replace: '        store.getState().select([id]);',
    },
    {
      // A plain press must REPLACE. Extending instead means the selection only ever
      // grows and never narrows to one node.
      name: 'plain press extends the selection instead of replacing it',
      file: 'apps/web/src/Canvas.tsx',
      find: '        store.getState().select([id]);',
      replace: '        store.getState().extendSelection([id]);',
    },

    /* ---- the overlay --------------------------------------------------- */
    {
      // The measured boxes never reach state: the selection is real, and invisible.
      name: 'overlay computes boxes but never renders them',
      file: 'apps/web/src/SelectionLayer.tsx',
      find: '    setBoxes(next);',
      replace: '    setBoxes([]);',
    },
    {
      // Only the first selected node gets a box, so multi-select looks like
      // single-select — a box on one of the several chosen nodes.
      name: 'overlay draws a box for only the first selected node',
      file: 'apps/web/src/SelectionLayer.tsx',
      find: '    for (const id of selection) {\n      const element = doc.querySelector(`[data-vpb-node-id="${id}"]`);\n      if (!element) continue;\n      const rect = element.getBoundingClientRect();',
      replace:
        '    for (const id of selection.slice(0, 1)) {\n      const element = doc.querySelector(`[data-vpb-node-id="${id}"]`);\n      if (!element) continue;\n      const rect = element.getBoundingClientRect();',
    },
  ],
};
