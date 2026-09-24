/**
 * Storage plumbing for the client stores.
 *
 * Why this file exists:
 * 1. `localStorage` throws in Safari private mode, is absent during SSR and in
 *    unit tests — every store falls back to an in-memory map instead of
 *    crashing the render.
 * 2. Storage must be resolved *per access*, not captured at module load:
 *    Next.js evaluates client-component modules on the server first (where
 *    `window` does not exist), and a storage object bound at import time would
 *    silently disable persistence in the browser bundle.
 * 3. Corrupt/foreign JSON must never break a store: a failed parse yields
 *    "nothing persisted" rather than a thrown error inside a render.
 * 4. A "persistent cart" is a conversion feature; tabs must not clobber each
 *    other, so we expose a cross-tab sync helper instead of duplicating
 *    `storage` listeners.
 */
import type { PersistStorage, StorageValue, StateStorage } from "zustand/middleware";

const memory = new Map<string, string>();

const memoryStorage: StateStorage = {
  getItem: (name) => memory.get(name) ?? null,
  setItem: (name, value) => {
    memory.set(name, value);
  },
  removeItem: (name) => {
    memory.delete(name);
  },
};

/** `localStorage` when usable, in-memory otherwise (SSR / private mode / tests). */
export function safeStorage(): StateStorage {
  if (typeof window === "undefined") return memoryStorage;
  try {
    const probe = "__bale_drop_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return memoryStorage;
  }
}

/**
 * JSON persist storage bound to {@link safeStorage}, resolved lazily on every
 * read/write. Malformed payloads are treated as "no state" instead of throwing.
 */
export function persistStorage<T>(): PersistStorage<T> {
  const resolve = () => safeStorage();
  return {
    getItem: (name) => {
      const raw = resolve().getItem(name);
      // `StateStorage.getItem` is allowed to be async; our backends are sync, so
      // a promise here means a foreign storage adapter and there is nothing to read.
      if (typeof raw !== "string" || raw.length === 0) return null;
      try {
        return JSON.parse(raw) as StorageValue<T>;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        resolve().setItem(name, JSON.stringify(value));
      } catch {
        /* quota exceeded or storage disabled — the app keeps working in memory */
      }
    },
    removeItem: (name) => resolve().removeItem(name),
  };
}

/**
 * Re-run rehydration when another tab writes one of `names`.
 * Returns an unsubscribe function (safe to call during effect cleanup).
 */
export function syncAcrossTabs(names: string[], onSync: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: StorageEvent) => {
    if (!event.key) return;
    if (names.some((name) => event.key === name || event.key?.startsWith(`${name}:`))) onSync();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

/** Remove a storage key without throwing (private mode, disabled storage). */
export function dropStorageKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable — nothing to clean up */
  }
}
