/**
 * PHASE F1 — the store's persistence orchestration: `save`, `loadDocument`,
 * `newDocument`, and the `isDirty` checkpoint the dirty-state review proved
 * correct transition by transition. Its bugs are the ones a single-command
 * test cannot see — `save` reading the wrong half of the store, a checkpoint
 * that forgets which edit it was anchored to, a load that trusts an unvalidated
 * payload. Runs against the `state` project alone; every `find` is a single
 * line.
 */
export default {
  name: 'F1 — store persistence + dirty-state',
  testCommand: 'pnpm vitest run --project state --silent',
  mutations: [
    {
      // THE load-bearing property the whole design review turned on: a save
      // must read `committed`, never `present`, or an in-flight drag/resize
      // preview gets written to disk.
      name: 'save() persists `present` instead of `committed`',
      file: 'packages/state/src/store.ts',
      find: '        const file = createDocumentFile(committed.project, new Date(now()).toISOString());',
      replace:
        '        const file = createDocumentFile(get().present.project, new Date(now()).toISOString());',
    },
    {
      // The checkpoint must re-anchor to whatever is CURRENTLY at the top of
      // history, not a fixed value — otherwise saving after an undo marks the
      // wrong state clean.
      name: 'the checkpoint always anchors to null instead of the current history tail',
      file: 'packages/state/src/store.ts',
      find: "        set({ saveState: { kind: 'saved', entry: history.past.at(-1) ?? null } });",
      replace: "        set({ saveState: { kind: 'saved', entry: null } });",
    },
    {
      // A brand-new, never-saved document must report dirty unconditionally —
      // losing this means a document that has never touched storage looks
      // "clean" and a close-without-saving loses it silently.
      name: 'isDirty() treats a never-saved document as clean',
      file: 'packages/state/src/store.ts',
      find: "        if (saveState.kind === 'never-saved') return true;",
      replace: "        if (saveState.kind === 'never-saved') return false;",
    },
    {
      // The whole dirty check inverted: an edited document would report clean
      // and a freshly saved one would report dirty.
      name: 'isDirty() comparison is inverted',
      file: 'packages/state/src/store.ts',
      find: '        return (history.past.at(-1) ?? null) !== saveState.entry;',
      replace: '        return (history.past.at(-1) ?? null) === saveState.entry;',
    },
    {
      // Skipping the deserialize-failure check means a corrupt or malformed
      // saved payload is trusted anyway — exactly what "validate fully before
      // replacing store state" exists to prevent.
      name: 'loadDocument ignores a deserialize validation failure',
      file: 'packages/state/src/store.ts',
      find: '        if (!result.ok) {',
      replace: '        if (false) {',
    },
    {
      // A `newDocument` that ignores the caller's name is a small but real
      // correctness bug: every new document silently opens as "Untitled".
      name: 'newDocument ignores the given name',
      file: 'packages/state/src/store.ts',
      find: "        const project = createProject(name ?? 'Untitled', ids);",
      replace: "        const project = createProject('Untitled', ids);",
    },
  ],
};
