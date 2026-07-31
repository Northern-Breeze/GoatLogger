import type { LogEntry, Persistence } from "../core/types";

const STORAGE_KEY = "goatlogger:dead-letter";

function readAll(): LogEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: LogEntry[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage full or unavailable (e.g. private mode) — best-effort persistence, drop silently
  }
}

export function createStoragePersistence(): Persistence {
  return {
    enqueue(entries: LogEntry[]): void {
      if (entries.length === 0) return;
      const all = readAll();
      all.push(...entries);
      writeAll(all);
    },
    dequeue(max: number): LogEntry[] {
      const all = readAll();
      const taken = all.slice(0, max);
      writeAll(all.slice(max));
      return taken;
    },
    size(): number {
      return readAll().length;
    },
    clear(): void {
      if (typeof localStorage === "undefined") return;
      localStorage.removeItem(STORAGE_KEY);
    },
  };
}
