import type { LogEntry, Persistence } from "../core/types";

export function createMemoryPersistence(): Persistence {
  let buffer: LogEntry[] = [];

  return {
    enqueue(entries: LogEntry[]): void {
      buffer.push(...entries);
    },
    dequeue(max: number): LogEntry[] {
      const taken = buffer.slice(0, max);
      buffer = buffer.slice(max);
      return taken;
    },
    size(): number {
      return buffer.length;
    },
    clear(): void {
      buffer = [];
    },
  };
}
