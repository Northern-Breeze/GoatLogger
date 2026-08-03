/** Minimal Web Storage double — Bun's runtime has no `localStorage` global by default. */
export class FakeStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/** Installs a FakeStorage as `globalThis.localStorage` and returns a restore function. */
export function installFakeLocalStorage(): { storage: FakeStorage; restore: () => void } {
  const previous = (globalThis as { localStorage?: unknown }).localStorage;
  const storage = new FakeStorage();
  (globalThis as { localStorage?: unknown }).localStorage = storage;

  return {
    storage,
    restore: () => {
      (globalThis as { localStorage?: unknown }).localStorage = previous;
    },
  };
}
