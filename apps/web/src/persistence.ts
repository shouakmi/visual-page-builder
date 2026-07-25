import {
  createAutosaveController,
  type AutosaveController,
  type AutosaveOptions,
  type EditorStore,
} from '@vpb/state';
import { createIndexedDbStorageAdapter, type StorageAdapter } from '@vpb/storage';
import type { StoreApi } from 'zustand';

/**
 * Browser persistence wiring (Phase F2). The ONE place `apps/web` turns the
 * platform's IndexedDB into a `StorageAdapter` and decides whether autosave runs
 * — keeping every browser-specific concern in the app, out of `@vpb/state` and
 * `@vpb/storage`.
 */

/**
 * The browser's `StorageAdapter`, or `null` where IndexedDB is unavailable — a
 * jsdom test, a privacy-locked browser, a disabled context. The factory is
 * passed in rather than read from a global so this is testable with
 * `fake-indexeddb` and so the global read lives at the single call site (App).
 */
export function createBrowserStorage(factory: IDBFactory | undefined): StorageAdapter | null {
  return factory ? createIndexedDbStorageAdapter({ factory }) : null;
}

/**
 * Attach autosave ONLY when a storage adapter exists. Without one, every edit
 * would fire a pointless `io-error` save; returning `null` lets the caller (and
 * a test) confirm nothing was wired.
 */
export function attachAutosave(
  store: StoreApi<EditorStore>,
  adapter: StorageAdapter | null,
  options?: AutosaveOptions,
): AutosaveController | null {
  if (!adapter) return null;
  return createAutosaveController(store, options ?? {});
}
