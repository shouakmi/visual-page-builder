/**
 * PHASE F2 — the autosave controller.
 *
 * The debounce/trailing policy over the store's `save()`. These mutations pin
 * the four guarantees the design turned on: never save mid-gesture, never save a
 * clean document, debounce a burst to one save, never overlap a save, always
 * trail an edit that landed during one, and tear down cleanly on dispose. Runs
 * against the `state` project alone; every `find` is a single line.
 */
export default {
  name: 'F2 — autosave controller',
  testCommand: 'pnpm vitest run --project state --silent',
  mutations: [
    {
      // A live drag/resize preview lives only in `present`; saving mid-gesture
      // would race the commit and could persist a half-finished edit.
      name: 'the pending guard is removed, so autosave fires mid-gesture',
      file: 'packages/state/src/autosave.ts',
      find: '    if (state.pending !== null) return;',
      replace: '',
    },
    {
      name: 'the dirty guard is removed, so a clean document is saved anyway',
      file: 'packages/state/src/autosave.ts',
      find: '    if (!state.isDirty()) return;',
      replace: '',
    },
    {
      // Without clearing the previous timer, every keystroke in a burst arms its
      // own save instead of the burst collapsing to one.
      name: 'the debounce no longer resets, so a burst arms many saves',
      file: 'packages/state/src/autosave.ts',
      find: '    if (timer !== null) clearTimer(timer);',
      replace: '',
    },
    {
      // An edit that lands while a save is in flight is dropped by the
      // save-time subscribe guard; only the trailing check recovers it.
      name: 'the trailing save is dropped, so a mid-save edit is never persisted',
      file: 'packages/state/src/autosave.ts',
      find: '        if (!disposed && result.ok && store.getState().isDirty()) schedule();',
      replace: '',
    },
    {
      // With the flag never set, the subscribe guard stops suppressing
      // notifications during a save, so a second save can be armed over the first.
      name: 'the in-flight flag is never set, so a save can overlap another',
      file: 'packages/state/src/autosave.ts',
      find: '    saving = true;',
      replace: '',
    },
    {
      // A controller that leaves its timer armed after dispose is exactly the
      // HMR leak the App teardown exists to prevent.
      name: 'dispose no longer cancels the armed timer',
      file: 'packages/state/src/autosave.ts',
      find: '        clearTimer(timer);',
      replace: '',
    },
  ],
};
