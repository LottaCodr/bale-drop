/**
 * Minimal browser shim for the store tests: a real (in-memory) `localStorage`
 * plus `window` so the persistence paths are exercised exactly as they are in
 * the browser — no jsdom dependency, no mocking of our own storage layer.
 */
class MemoryLocalStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const listeners = new Set<(event: { key: string | null }) => void>();

const windowShim = {
  localStorage: new MemoryLocalStorage(),
  addEventListener: (type: string, handler: (event: { key: string | null }) => void) => {
    if (type === "storage") listeners.add(handler);
  },
  removeEventListener: (type: string, handler: (event: { key: string | null }) => void) => {
    if (type === "storage") listeners.delete(handler);
  },
  dispatchEvent: () => true,
  location: { pathname: "/", href: "https://baledrop.test/" },
  sessionStorage: new MemoryLocalStorage(),
};

(globalThis as unknown as { window: typeof windowShim }).window = windowShim;
(globalThis as unknown as { document: unknown }).document = {
  documentElement: { classList: { toggle: () => undefined }, style: {} },
};

export { windowShim };
