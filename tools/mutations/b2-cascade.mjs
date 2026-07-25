/**
 * PHASE B2 — the cascade engine.
 *
 * This set did not exist until Phase D began. The README claimed "B2 and B3 were
 * both built this way", but only `b3-document.mjs` was ever on disk — B2's set
 * was presumably lost with the two test suites in the 2026-07-17 incident, and
 * nothing noticed, because a missing mutation set fails silently by definition.
 *
 * It is written now because Phase D changed the cascade: class precedence moved
 * from the ELEMENT's list to `sheet.classOrder`. That change exists to make the
 * emitter faithful, so the mutations below are mostly about the ways it could
 * quietly stop being faithful.
 */
export default {
  name: 'B2 — cascade engine',
  testCommand: 'pnpm vitest run --project core --project state --silent',
  mutations: [
    /* ---- class precedence is the sheet's, not the element's ------------ */
    {
      // THE BUG PHASE D FOUND. Reading precedence off the element's list makes
      // the model more expressive than CSS: two elements with the same classes
      // in opposite orders each demand a different winner, and one global source
      // order can satisfy only one of them. The emitter could never reproduce it
      // -- an unfixable WYSIWYG hole (AUDIT 4.7) living in the model.
      name: 'class precedence read from the element instead of the sheet',
      file: 'packages/core/src/style/resolve.ts',
      find: '  const applied = new Set(query.classes);\n  const scopes: StyleScope[] = sheet.classOrder\n    .filter((name) => applied.has(name))\n    .map((name) => classScope(name));',
      replace: '  const scopes: StyleScope[] = query.classes.map((name) => classScope(name));',
    },
    {
      // Reversing the rank inverts every class conflict in the document.
      name: 'class order applied strongest-first instead of weakest-first',
      file: 'packages/core/src/style/resolve.ts',
      find: '  const scopes: StyleScope[] = sheet.classOrder\n    .filter((name) => applied.has(name))\n    .map((name) => classScope(name));',
      replace:
        '  const scopes: StyleScope[] = [...sheet.classOrder]\n    .reverse()\n    .filter((name) => applied.has(name))\n    .map((name) => classScope(name));',
    },
    {
      // Node-local must outrank every class, or a local tweak silently loses to
      // a class rule and the user's explicit instruction evaporates.
      name: 'node-local scope ranked before classes instead of after',
      file: 'packages/core/src/style/resolve.ts',
      find: '  if (query.nodeId !== null) scopes.push(nodeScope(query.nodeId));\n  return scopes;',
      replace:
        '  if (query.nodeId !== null) scopes.unshift(nodeScope(query.nodeId));\n  return scopes;',
    },

    /* ---- maintaining the ranking --------------------------------------- */
    {
      // A newly styled class must land at the strongest position: the author
      // just made it and styled it, and expects that to take effect.
      name: 'a newly styled class is ranked weakest instead of strongest',
      file: 'packages/core/src/style/stylesheet.ts',
      find: '  return [...order, scope.name];',
      replace: '  return [scope.name, ...order];',
    },
    {
      // THE TRAP. If unsetting a class's last property dropped its rank,
      // restyling it would append it at the strongest position -- a property it
      // used to lose it would now win, from an edit that touched one value.
      name: 'removing a rule also drops its class from the ranking',
      file: 'packages/core/src/style/stylesheet.ts',
      find: '  return {\n    rules,\n    index: indexWithout(sheet.index, rule.scope, rule.target),\n    classOrder: sheet.classOrder,\n  };',
      replace:
        '  return {\n    rules,\n    index: indexWithout(sheet.index, rule.scope, rule.target),\n    classOrder:\n      rule.scope.kind === "class"\n        ? sheet.classOrder.filter((n) => n !== rule.scope.name)\n        : sheet.classOrder,\n  };',
    },
    {
      // A deleted class that keeps its rank leaves a rank with no rules --
      // harmless alone, but removeScope is the deliberate delete and must clean
      // up, or the ranking grows without bound across a long session.
      name: 'removeScope leaves the deleted class in the ranking',
      file: 'packages/core/src/style/stylesheet.ts',
      find: "    scope.kind === 'class'\n      ? sheet.classOrder.filter((name) => name !== scope.name)\n      : sheet.classOrder;",
      replace: '    sheet.classOrder;',
    },
    {
      // A styled class with no rank is invisible to scopesFor: its rules are in
      // the sheet and simply never apply. The guard is what turns that from a
      // silent no-render into a failure.
      name: 'validate no longer catches a styled class with no rank',
      file: 'packages/core/src/style/stylesheet.ts',
      find: "    if (rule.scope.kind === 'class' && !ranked.has(rule.scope.name)) {",
      replace: '    if (false) {',
    },

    /* ---- setClassOrder -------------------------------------------------- */
    {
      // A partial reorder must not silently unrank the classes it omits, or
      // their rules drop out of the cascade entirely.
      name: 'setClassOrder drops classes omitted from the new order',
      file: 'packages/core/src/style/stylesheet.ts',
      find: '  for (const name of sheet.classOrder) {\n    if (!ranked.includes(name)) ranked.push(name);\n  }',
      replace: '',
    },
    {
      // Accepting arbitrary names would let a typo rank a class that does not
      // exist, and validate would then report a duplicate-free but bogus order.
      name: 'setClassOrder accepts names the sheet has never styled',
      file: 'packages/core/src/style/stylesheet.ts',
      find: '    if (known.has(name) && !ranked.includes(name)) ranked.push(name);',
      replace: '    if (!ranked.includes(name)) ranked.push(name);',
    },
  ],
};
