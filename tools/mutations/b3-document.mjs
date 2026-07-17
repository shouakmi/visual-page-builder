/**
 * PHASE B3 — document model (node tree, component registry, pages/project).
 *
 * Each mutation reintroduces a real bug. Most are bugs the prototype actually
 * shipped, cited to the AUDIT section that found them; the rest are the classic
 * errors this design exists to prevent (tree cycles, drag off-by-one).
 *
 * Adding a mutation is the cheapest way to state "the suite must catch this".
 * If one goes STALE the code moved — re-point it rather than deleting it, or the
 * guarantee quietly disappears.
 */
export default {
  name: 'B3 — document model',
  testCommand: 'pnpm vitest run --project core --silent',
  mutations: [
    /* ---- the node tree: structure ------------------------------------- */
    {
      // Dropping a node into its own descendant detaches the branch into a ring
      // that points at itself: the layer panel recurses forever and the page is
      // unrecoverable. Every tree editor must answer this before every drop.
      name: 'cycle guard removed (drop node into own descendant)',
      file: 'packages/core/src/node/tree.ts',
      find: '  return !isAncestor(tree, id, newParentId);',
      replace: '  return true;',
    },
    {
      // `index` is a position in the children array as the user sees it, before
      // the move. Removing the node first shifts later siblings down one, so a
      // same-parent move to a later index lands one slot too far right. Users
      // reproduce this on their first drag.
      name: 'move index not adjusted for same-parent later move',
      file: 'packages/core/src/node/tree.ts',
      find: '  if (sameParent && currentIndex !== -1 && at > currentIndex) at -= 1;',
      replace: '',
    },
    {
      name: 'parent index not updated on reparent',
      file: 'packages/core/src/node/tree.ts',
      find: '  const parents = new Map(next.parents);\n  parents.set(id, newParentId);\n  return { ...next, parents };',
      replace: '  return next;',
    },
    {
      name: 'removeNode drops only the node, orphaning its subtree',
      file: 'packages/core/src/node/tree.ts',
      find: '  const removed = subtreeIds(tree, id);',
      replace: '  const removed = [id];',
    },
    {
      // AUDIT §4.4: the prototype's insertNode could only append, which is why
      // it had no insert-before, no insert-after, and no drop position.
      name: "insertNode appends, ignoring the index (the prototype's bug)",
      file: 'packages/core/src/node/tree.ts',
      find: '  const at = clampIndex(index, parent.children.length);\n  const nodes = new Map(tree.nodes);',
      replace: '  const at = parent.children.length;\n  const nodes = new Map(tree.nodes);',
    },
    {
      name: "updateNode honours a caller's children array",
      file: 'packages/core/src/node/tree.ts',
      find: '  return withNode(tree, { ...node, children: existing.children });',
      replace: '  return withNode(tree, node);',
    },
    {
      name: 'insertNode accepts a node arriving with children',
      file: 'packages/core/src/node/tree.ts',
      find: '  if (node.children.length > 0) return tree;',
      replace: '',
    },
    {
      name: 'removeNode allows deleting the root',
      file: 'packages/core/src/node/tree.ts',
      find: '  if (id === tree.root || !tree.nodes.has(id)) return { tree, removed: [] };',
      replace: '  if (!tree.nodes.has(id)) return { tree, removed: [] };',
    },
    {
      name: 'canDropNode ignores locked nodes',
      file: 'packages/core/src/node/tree.ts',
      find: '  if (node.locked) return false;',
      replace: '',
    },

    /* ---- pages and project -------------------------------------------- */
    {
      // Node-scoped rules are keyed by node id and live in the project sheet.
      // Skipping the sweep leaks them into every future export, forever.
      name: 'removePage leaks the style rules of its nodes',
      file: 'packages/core/src/document/project.ts',
      find: '  let styles = project.styles;\n  for (const nodeId of page.tree.nodes.keys()) {\n    styles = removeScope(styles, nodeScope(nodeId));\n  }',
      replace: '  const styles = project.styles;',
    },
    {
      name: 'duplicatePage does not copy node-scoped rules',
      file: 'packages/core/src/document/project.ts',
      find: '    for (const rule of rulesForScope(project.styles, scope)) {',
      replace: '    for (const rule of []) {',
    },
    {
      // Two pages at one route overwrite each other at export: the user loses a
      // page they can still see in the panel.
      name: 'addPage allows a colliding path',
      file: 'packages/core/src/document/project.ts',
      find: '  if (pathInUse(project, page.path)) return project;',
      replace: '',
    },
    {
      name: 'removePage allows deleting the last page',
      file: 'packages/core/src/document/project.ts',
      find: '  if (project.pages.length <= 1) return project;',
      replace: '',
    },
    {
      // Page paths become file paths on export, so `..` escapes the output dir.
      name: 'page path allows directory traversal',
      file: 'packages/core/src/document/page.ts',
      find: "  if (normalized.split('/').some((segment) => segment === '..' || segment === '.')) return false;",
      replace: '',
    },
    {
      name: 'page path is not normalized (/, /about/, about all differ)',
      file: 'packages/core/src/document/page.ts',
      find: '    path: normalizePath(path),',
      replace: '    path,',
    },

    /* ---- props and the component registry ------------------------------ */
    {
      // A stale project file carrying `level: "ghsot"` would fall through every
      // branch of the renderer and emit an unstyled element.
      name: 'select prop accepts a value outside its options',
      file: 'packages/core/src/node/props.ts',
      find: "      return (\n        value.kind === 'string' && (definition.options ?? []).some((o) => o.value === value.value)\n      );",
      replace: "      return value.kind === 'string';",
    },
    {
      // The whole argument for a structured PropValue: with src as a bare
      // string, "which nodes use this asset?" is unanswerable.
      name: 'asset prop is indistinguishable from a string',
      file: 'packages/core/src/node/props.ts',
      find: "    if (value.kind === 'asset' && !out.includes(value.id)) out.push(value.id);",
      replace: '',
    },
    {
      // AUDIT §6: the prototype's text node did `return props.text` and silently
      // dropped any children it had.
      name: 'text-only component accepts children (prototype dropped them)',
      file: 'packages/core/src/node/component.ts',
      find: "  if (parent.children !== 'flow') return false;",
      replace: '',
    },
    {
      name: 'allowedParents constraint ignored',
      file: 'packages/core/src/node/component.ts',
      find: '  if (child.allowedParents && !child.allowedParents.includes(parent.id)) return false;',
      replace: '',
    },
  ],
};
