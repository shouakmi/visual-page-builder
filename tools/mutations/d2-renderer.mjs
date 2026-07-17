/**
 * PHASE D2 — the canvas renderer.
 *
 * AUDIT §4.5 ("the renderer is an XSS vector") and §4.6 ("the iframe is
 * destroyed on every state change") are the two findings this package exists to
 * kill, and both die structurally: React builds elements rather than
 * concatenating strings, so text cannot become markup and an edit touches one
 * node instead of rewriting the document.
 *
 * Structural properties are the easiest ones to lose by accident, because
 * nothing about the code looks wrong afterwards. `dangerouslySetInnerHTML` is
 * one identifier. Dropping `n-<id>` from a class list leaves a page that renders
 * perfectly and has lost every node-local style. These are those mutations.
 */
export default {
  name: 'D2 — canvas renderer',
  testCommand: 'pnpm vitest run --project renderer --silent',
  mutations: [
    /* ---- §4.5: escaping is structural, until someone opts out ---------- */
    {
      // The prototype's bug, reachable in React only by asking for it. One
      // identifier turns user text back into markup.
      name: 'text rendered through dangerouslySetInnerHTML',
      file: 'packages/renderer/src/renderers.tsx',
      find: "const textRenderer: NodeRenderer = ({ node, definition, className }) =>\n  createElement(definition.tag, { className }, stringProp(node, 'text') ?? '');",
      replace:
        "const textRenderer: NodeRenderer = ({ node, definition, className }) =>\n  createElement(definition.tag, {\n    className,\n    dangerouslySetInnerHTML: { __html: stringProp(node, 'text') ?? '' },\n  });",
    },
    {
      // `javascript:` in an href is script execution on click -- the same hole,
      // wearing an attribute instead of a tag.
      name: 'href no longer checked with isSafeUrl',
      file: 'packages/renderer/src/renderers.tsx',
      find: '  return isSafeUrl(value.href) ? value.href : undefined;',
      replace: '  return value.href;',
    },
    {
      // An asset src arrives from a persisted file and is equally untrusted.
      name: 'image src no longer checked with isSafeUrl',
      file: 'packages/renderer/src/renderers.tsx',
      find: '  const safeSrc = asset && isSafeUrl(asset.src) ? asset.src : undefined;',
      replace: '  const safeSrc = asset?.src;',
    },
    {
      // createElement(userString) emits whatever tag the file asked for.
      name: 'heading level trusted without checking its options',
      file: 'packages/renderer/src/renderers.tsx',
      find: '  const tag = level !== undefined && allowed?.includes(level) ? level : definition.tag;',
      replace: '  const tag = level ?? definition.tag;',
    },
    {
      name: 'button type trusted without checking its options',
      file: 'packages/renderer/src/renderers.tsx',
      find: "      type: type !== undefined && allowed?.includes(type) ? type : 'button',",
      replace: "      type: type ?? 'button',",
    },

    /* ---- the compiler's other half ------------------------------------ */
    {
      // THE SILENT ONE. compileStyleSheet emits node rules as `.n-<id>`; without
      // the class on the element every node-local style stops applying. The CSS
      // is right, the DOM is right, the page is wrong.
      name: 'node class dropped from the element class list',
      file: 'packages/renderer/src/renderers.tsx',
      find: "  return [nodeClassName(node.id), ...node.classes].join(' ');",
      replace: "  return node.classes.join(' ');",
    },
    {
      name: 'class references dropped, leaving only the node class',
      file: 'packages/renderer/src/renderers.tsx',
      find: "  return [nodeClassName(node.id), ...node.classes].join(' ');",
      replace: '  return nodeClassName(node.id);',
    },

    /* ---- §4.6: incremental, not rebuilt -------------------------------- */
    {
      // Keys are node ids so React reparents rather than rebuilds. Index keys
      // recreate every element after a removal: an in-flight image restarts and
      // the caret jumps -- exactly what doc.write did, more quietly.
      name: 'children keyed by index instead of node id',
      file: 'packages/renderer/src/RenderTree.tsx',
      find: '      ? childrenOf(tree, id).map((child) => (\n          <Fragment key={child.id}>{renderNode(tree, child.id, env)}</Fragment>\n        ))',
      replace:
        '      ? childrenOf(tree, id).map((child, index) => (\n          <Fragment key={index}>{renderNode(tree, child.id, env)}</Fragment>\n        ))',
    },

    /* ---- visibility ---------------------------------------------------- */
    {
      // The layer panel's eye icon becomes a lie the moment someone exports.
      name: 'hidden nodes rendered anyway',
      file: 'packages/renderer/src/RenderTree.tsx',
      find: '  if (node.hidden === true) return null;',
      replace: '',
    },
    {
      name: 'unknown component throws instead of rendering nothing',
      file: 'packages/renderer/src/RenderTree.tsx',
      find: '  const definition = getComponent(env.registry, node.component);\n  if (!definition) {',
      replace:
        '  const definition = getComponent(env.registry, node.component);\n  if (!definition) throw new Error(`unknown component ${node.component}`);\n  if (false) {',
    },

    /* ---- the registry is data, not a switch ---------------------------- */
    {
      // A plugin ships its definition and renderer together. Ignoring the map
      // and always using the default is the hardcoded switch, reintroduced.
      name: 'renderer map ignored in favour of the default renderer',
      file: 'packages/renderer/src/RenderTree.tsx',
      find: '  const render = env.renderers.get(node.component) ?? defaultRenderer;',
      replace: '  const render = defaultRenderer;',
    },
    {
      // `text` and `none` policies take no child nodes; walking them is walking
      // an array the model guarantees is empty -- but a flow component that
      // stops walking loses its whole subtree.
      name: 'children never walked, flattening every container',
      file: 'packages/renderer/src/RenderTree.tsx',
      find: "    definition.children === 'flow'",
      replace: "    definition.children === 'never-matches'",
    },
  ],
};
