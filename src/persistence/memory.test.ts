import { describe, expect, test } from "bun:test";
import { createMemoryPersistence } from "./memory";
import type { LogEntry } from "../core/types";

function makeEntry(id: string): LogEntry {
  return {
    id,
    level: "error",
    message: `entry ${id}`,
    timestamp: new Date().toISOString(),
    service: "test-service",
    sessionId: "s-test",
    platform: "node",
  };
}

describe("createMemoryPersistence", () => {
  test("starts empty", () => {
    const store = createMemoryPersistence();
    expect(store.size()).toBe(0);
    expect(store.dequeue(10)).toEqual([]);
  });

  test("enqueue appends and size reflects the buffer length", () => {
    const store = createMemoryPersistence();
    store.enqueue([makeEntry("1"), makeEntry("2")]);
    expect(store.size()).toBe(2);
  });

  test("dequeue removes entries FIFO, up to max, and leaves the rest", () => {
    const store = createMemoryPersistence();
    store.enqueue([makeEntry("1"), makeEntry("2"), makeEntry("3")]);

    const first = store.dequeue(2);

    expect(first.map((e) => e.id)).toEqual(["1", "2"]);
    expect(store.size()).toBe(1);
    expect(store.dequeue(10).map((e) => e.id)).toEqual(["3"]);
  });

  test("dequeue with max greater than size drains everything without error", () => {
    const store = createMemoryPersistence();
    store.enqueue([makeEntry("1")]);

    expect(store.dequeue(50).map((e) => e.id)).toEqual(["1"]);
    expect(store.size()).toBe(0);
  });

  test("clear empties the buffer", () => {
    const store = createMemoryPersistence();
    store.enqueue([makeEntry("1"), makeEntry("2")]);

    store.clear();

    expect(store.size()).toBe(0);
  });

  test("each createMemoryPersistence() call is an independent store", () => {
    const a = createMemoryPersistence();
    const b = createMemoryPersistence();

    a.enqueue([makeEntry("only-in-a")]);

    expect(a.size()).toBe(1);
    expect(b.size()).toBe(0);
  });
});
