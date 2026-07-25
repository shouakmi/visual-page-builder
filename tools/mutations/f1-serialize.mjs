/**
 * PHASE F1 — project serialization, schema versioning, and the flat-array
 * `NodeTree` reconstruction seam (`buildNodeTree`).
 *
 * `serializeProject`/`deserializeProject`/`deserializeDocumentFile` are the
 * whole reason a saved project can be trusted when it comes back: silent data
 * loss on the way out, or silently accepting corrupt/future-versioned JSON on
 * the way in, would be invisible until a user's real document broke. Runs
 * against the `core` project alone; every `find` is a single line.
 */
export default {
  name: 'F1 — project serialize/deserialize + buildNodeTree',
  testCommand: 'pnpm vitest run --project core --silent',
  mutations: [
    {
      // A dropped classOrder on every save silently resets which class wins on
      // every element that has more than one — invisible until two classes
      // stop agreeing with what the user last saw on screen.
      name: 'serializeProject drops the class order',
      file: 'packages/core/src/document/serialize.ts',
      find: '    styles: { rules: allRules(project.styles), classOrder: project.styles.classOrder },',
      replace: '    styles: { rules: allRules(project.styles), classOrder: [] },',
    },
    {
      // A file from a future app version must be refused, not guessed at — this
      // is the one line standing between "unsupported" and silently trying to
      // open a shape this version has never seen.
      name: 'a newer-than-supported schema version is accepted instead of refused',
      file: 'packages/core/src/document/serialize.ts',
      find: '  if (version > SCHEMA_VERSION) {',
      replace: '  if (false) {',
    },
    {
      // validateProject is the ONLY check that catches two pages sharing a
      // path — removing it from the aggregate lets a corrupted or hand-edited
      // file open with two pages that would silently overwrite each other on
      // export.
      name: 'the final validateProject check is dropped from deserialization',
      file: 'packages/core/src/document/serialize.ts',
      find: '    ...validateProject(project),',
      replace: '',
    },
    {
      // buildNodeTree is the deserializer's whole reason to exist; an empty
      // parent index here means every loaded project renders with a root and a
      // pile of unreachable nodes.
      name: 'buildNodeTree stops recording any parent at all',
      file: 'packages/core/src/node/tree.ts',
      find: '  return { root, nodes: new Map(nodes.map((node) => [node.id, node] as const)), parents };',
      replace:
        '  return { root, nodes: new Map(nodes.map((node) => [node.id, node] as const)), parents: new Map() };',
    },
    {
      // A page whose node tree fails validateTree (a dangling child, an orphan)
      // must be refused, not opened — this is the one line deciding that.
      name: 'a page with a broken node tree is accepted instead of rejected',
      file: 'packages/core/src/document/serialize.ts',
      find: '  if (treeErrors.length > 0) {',
      replace: '  if (false) {',
    },
    {
      // The whole point of wrapping reconstruction in try/catch is that
      // deserializeProject NEVER throws past its boundary. Rethrowing here is
      // exactly the crash untrusted JSON must never cause.
      name: 'deserializeProject rethrows instead of returning a typed error',
      file: 'packages/core/src/document/serialize.ts',
      find: "    return { ok: false, error: { kind: 'invalid-shape', detail: message } };",
      replace: '    throw error;',
    },
    {
      // Ignoring a migration failure means an unsupported schema version falls
      // through to deserializeProject(undefined) instead of being reported as
      // what it actually is.
      name: 'deserializeDocumentFile ignores a migration failure',
      file: 'packages/core/src/document/serialize.ts',
      find: '  if (!migrated.ok) return migrated;',
      replace: '  if (false) return migrated;',
    },
  ],
};
