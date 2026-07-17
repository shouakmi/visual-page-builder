/**
 * PHASE D1 — the style compiler.
 *
 * AUDIT §4.7 calls unstyled export "the cardinal sin": the prototype's export
 * dropped every style, so the file the customer downloaded did not resemble the
 * page they built. The answer is one compiler shared by the canvas and the
 * exporter, and the thing that has to be true of it is not "it emits CSS" but
 * "it emits CSS the browser reads the way the resolver read the model".
 *
 * So most of these mutations do not break the CSS. They produce a perfectly
 * valid stylesheet that renders a different page — which is exactly the failure
 * mode that shipped, and exactly what a golden file alone would bless if it were
 * regenerated after the change.
 */
export default {
  name: 'D1 — style compiler',
  testCommand: 'pnpm vitest run --project core --silent',
  mutations: [
    /* ---- selectors ------------------------------------------------------ */
    {
      // An #id selector is (1,0,0): it outranks EVERY class at every breakpoint,
      // so `.btn:hover` would lose to the node's resting colour and no emission
      // order could fix it. As a class it ties at (0,1,0) and source order
      // decides -- which is what puts precedence in the emitter's hands.
      name: 'node scope emitted as an #id selector instead of a class',
      file: 'packages/core/src/style/compile.ts',
      find: "  const base = scope.kind === 'class' ? `.${scope.name}` : `.${nodeClassName(scope.nodeId)}`;",
      replace: "  const base = scope.kind === 'class' ? `.${scope.name}` : `#${scope.nodeId}`;",
    },
    {
      // A CSS identifier may not start with a digit, and an id can.
      name: 'node class emitted without its prefix',
      file: 'packages/core/src/style/compile.ts',
      find: '  return `n-${id}`;',
      replace: '  return `${id}`;',
    },
    {
      name: 'state selector dropped, so :hover rules overwrite the resting style',
      file: 'packages/core/src/style/compile.ts',
      find: '  const state = stateSelector(target.state);',
      replace: "  const state = '';",
    },
    {
      name: 'pseudo-element selector dropped',
      file: 'packages/core/src/style/compile.ts',
      find: "  const pseudo = target.pseudo === null ? '' : pseudoSelector(target.pseudo);",
      replace: "  const pseudo = '';",
    },

    /* ---- the precedence, bought with source order ----------------------- */
    {
      // THE INVARIANT. Classes must precede node rules or scope stops beating
      // breakpoint: `.n-x` base would be emitted before `@media { .btn }` and
      // the user's element-level value would evaporate on resize -- valid CSS,
      // wrong page.
      name: 'node scopes emitted before classes',
      file: 'packages/core/src/style/compile.ts',
      find: '  const scopes: StyleScope[] = sheet.classOrder.map((name) => classScope(name));',
      replace: '  const scopes: StyleScope[] = [];',
    },
    {
      // Emitting the ranking backwards inverts every class conflict.
      name: 'classes emitted strongest-first',
      file: 'packages/core/src/style/compile.ts',
      find: '  const scopes: StyleScope[] = sheet.classOrder.map((name) => classScope(name));',
      replace:
        '  const scopes: StyleScope[] = [...sheet.classOrder].reverse().map((name) => classScope(name));',
    },
    {
      // cssOrder hands breakpoints over parents-first; reversing it means a base
      // rule is emitted after the mobile rule and wins at mobile width.
      name: 'breakpoints emitted narrowest-first',
      file: 'packages/core/src/style/compile.ts',
      find: '    for (const breakpoint of cssOrder(breakpoints)) {',
      replace: '    for (const breakpoint of [...cssOrder(breakpoints)].reverse()) {',
    },
    {
      name: 'media query dropped, flattening every breakpoint onto base',
      file: 'packages/core/src/style/compile.ts',
      find: '        const query = mediaQuery(breakpoint);',
      replace: '        const query = null;',
    },

    /* ---- what gets emitted ---------------------------------------------- */
    {
      // The node filter exists so a page does not carry another page's rules.
      // Ignoring it is a silent export bloat that grows with the project.
      name: 'node filter ignored, emitting every page rules into one page',
      file: 'packages/core/src/style/compile.ts',
      find: '    if (nodes && !nodes.has(rule.scope.nodeId)) continue;',
      replace: '',
    },
    {
      // Classes are project-wide. Filtering them by the page's nodes would drop
      // every class rule from the export.
      name: 'the node filter is applied to classes as well',
      file: 'packages/core/src/style/compile.ts',
      find: '  const scopes: StyleScope[] = sheet.classOrder.map((name) => classScope(name));',
      replace:
        '  const scopes: StyleScope[] = nodes ? [] : sheet.classOrder.map((name) => classScope(name));',
    },
    {
      name: 'a scope emits rules from every breakpoint at once',
      file: 'packages/core/src/style/compile.ts',
      find: '  const rules = rulesForScope(sheet, scope).filter(\n    (rule) => rule.target.breakpoint === breakpoint.id,\n  );',
      replace: '  const rules = rulesForScope(sheet, scope);',
    },
    {
      name: 'declarations serialised with the model name instead of the CSS name',
      file: 'packages/core/src/style/compile.ts',
      find: '`${indent}${cssPropertyName(property)}: ${serializeValue(value, ctx)};`',
      replace: '`${indent}${property}: ${serializeValue(value, ctx)};`',
    },
  ],
};
