import type { StorageResult } from '@vpb/storage';
import type { StoreApi } from 'zustand/vanilla';

import type { EditorStore } from './store.ts';

/**
 * AUTOSAVE — the debounce/trailing policy layer over the store's `save()` (F2).
 *
 * Headless by construction: it drives `save()` and touches nothing else, so
 * `@vpb/state`'s node Vitest project keeps it honest. The store already made the
 * two hard guarantees this builds on — `save()` reads `committed` (never a live
 * preview) and `isDirty()` is an O(1) checkpoint comparison — so this file's one
 * job is deciding WHEN to call `save()`, never HOW.
 *
 * Three invariants, each tested:
 *  - NEVER OVERLAPS A SAVE. Only one `save()` is ever in flight. Store
 *    notifications are ignored while one runs, so no second timer is armed
 *    mid-save; a follow-up save can only come from the completion handler.
 *  - NEVER SAVES MID-GESTURE. A drag/resize preview sets `pending`; a fire that
 *    finds `pending !== null` skips, and the gesture's eventual commit or cancel
 *    produces a store change that re-arms this.
 *  - TRAILING SAVE. Edits that land during an in-flight save are not lost: after
 *    a SUCCESSFUL save the handler re-checks `isDirty()` and schedules again.
 *
 * A FAILED save does NOT auto-retry — that would spin a tight loop whenever
 * storage is unavailable. The next store change re-arms it, and the host can
 * surface the failure through `onSettled` and offer a manual Save. For that same
 * reason the host should only attach a controller when a storage adapter is
 * configured; without one every edit would trigger a bounded but pointless
 * `io-error` save attempt.
 *
 * Notifications during a save are ignored deliberately — including the store's
 * OWN `set` inside `save()` (which writes `saveState` and would otherwise arm a
 * redundant timer). Nothing is missed: the post-save `isDirty()` check re-covers
 * any edit that arrived while the save was running.
 */

export const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 1000;

/** Opaque handle returned by the injected `setTimer`. */
export type TimerHandle = unknown;

export interface AutosaveOptions {
  readonly debounceMs?: number;
  /**
   * The timer seam — the same shape of injection as the store's `now`. Defaults
   * to the host's `setTimeout`/`clearTimeout`; tests pass a driven fake so the
   * debounce is exercised with no real clock and no `vi.useFakeTimers`.
   */
  readonly setTimer?: (callback: () => void, ms: number) => TimerHandle;
  readonly clearTimer?: (handle: TimerHandle) => void;
  /** Notified after each autosave attempt, ok or not — for a status indicator. */
  readonly onSettled?: (result: StorageResult<void>) => void;
}

export interface AutosaveController {
  /** Stop listening and cancel any armed save. Idempotent. */
  dispose(): void;
}

export function createAutosaveController(
  store: StoreApi<EditorStore>,
  options: AutosaveOptions = {},
): AutosaveController {
  const debounceMs = options.debounceMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]));
  const { onSettled } = options;

  let timer: TimerHandle | null = null;
  let saving = false;
  let disposed = false;

  function schedule(): void {
    if (disposed) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(fire, debounceMs);
  }

  function fire(): void | Promise<void> {
    timer = null;
    if (disposed || saving) return;

    const state = store.getState();
    // Never mid-gesture: a live preview owns the document until it commits or
    // cancels, and either produces a store change that re-arms this.
    if (state.pending !== null) return;
    if (!state.isDirty()) return;

    saving = true;
    return state
      .save()
      .then((result) => {
        // A host status callback must never break persistence: a throw here is
        // contained so it can neither reject the save chain (an unhandled
        // rejection) nor skip the trailing save below.
        try {
          onSettled?.(result);
        } catch {
          // Intentionally swallowed — onSettled is an observer, not a step.
        }
        // Trailing save: a successful save reflects `committed` only as it was
        // when `save()` read it, so an edit that landed while it was in flight
        // leaves the document dirty and must be saved in turn. A FAILED save is
        // deliberately not retried here; a later change re-arms it.
        if (!disposed && result.ok && store.getState().isDirty()) schedule();
      })
      .finally(() => {
        saving = false;
      });
  }

  const unsubscribe = store.subscribe(() => {
    if (disposed || saving) return;
    schedule();
  });

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      unsubscribe();
    },
  };
}
