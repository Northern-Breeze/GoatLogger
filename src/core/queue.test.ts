import { describe, expect, test } from "bun:test";
import { BatchQueue } from "./queue";
import type { LogEntry, Persistence } from "./types";

function makeEntry(id: string): LogEntry {
  return {
    id,
    level: "info",
    message: `entry ${id}`,
    timestamp: new Date().toISOString(),
    service: "test-service",
    sessionId: "s-test",
    platform: "node",
  };
}

function makeDeadLetter(seed: LogEntry[] = []): Persistence {
  let buffer = [...seed];
  return {
    enqueue: (entries) => buffer.push(...entries),
    dequeue: (max) => {
      const taken = buffer.slice(0, max);
      buffer = buffer.slice(max);
      return taken;
    },
    size: () => buffer.length,
    clear: () => {
      buffer = [];
    },
  };
}

describe("BatchQueue", () => {
  test("flushes immediately once the buffer reaches batchSize, without waiting for the timer", () => {
    const flushed: LogEntry[][] = [];
    const queue = new BatchQueue({ batchSize: 2, flushInterval: 10_000, onFlush: (e) => flushed.push(e) });

    queue.add(makeEntry("1"));
    expect(flushed).toEqual([]);

    queue.add(makeEntry("2"));
    expect(flushed.length).toBe(1);
    expect(flushed[0]?.map((e) => e.id)).toEqual(["1", "2"]);
  });

  test("flushes a partial buffer once flushInterval elapses", async () => {
    const flushed: LogEntry[][] = [];
    const queue = new BatchQueue({ batchSize: 100, flushInterval: 15, onFlush: (e) => flushed.push(e) });

    queue.add(makeEntry("1"));
    expect(flushed).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(flushed.length).toBe(1);
    expect(flushed[0]?.map((e) => e.id)).toEqual(["1"]);
  });

  test("flush() on an empty buffer is a no-op", () => {
    const flushed: LogEntry[][] = [];
    const queue = new BatchQueue({ batchSize: 5, flushInterval: 10_000, onFlush: (e) => flushed.push(e) });

    queue.flush();

    expect(flushed).toEqual([]);
  });

  test("flush() clears the buffer so the same entries aren't sent twice", () => {
    const flushed: LogEntry[][] = [];
    const queue = new BatchQueue({ batchSize: 100, flushInterval: 10_000, onFlush: (e) => flushed.push(e) });

    queue.add(makeEntry("1"));
    queue.flush();
    queue.flush();

    expect(flushed.length).toBe(1);
  });

  test("flushAll() stops the timer and synchronously returns buffered entries without invoking onFlush", () => {
    const flushed: LogEntry[][] = [];
    const queue = new BatchQueue({ batchSize: 100, flushInterval: 10_000, onFlush: (e) => flushed.push(e) });

    queue.add(makeEntry("1"));
    queue.add(makeEntry("2"));
    const remaining = queue.flushAll();

    expect(remaining.map((e) => e.id)).toEqual(["1", "2"]);
    expect(flushed).toEqual([]);
  });

  test("add() is a no-op after flushAll() has destroyed the queue", () => {
    const flushed: LogEntry[][] = [];
    const queue = new BatchQueue({ batchSize: 1, flushInterval: 10_000, onFlush: (e) => flushed.push(e) });

    queue.flushAll();
    queue.add(makeEntry("late"));

    expect(flushed).toEqual([]);
    expect(queue.flushAll()).toEqual([]);
  });

  test("recovers dead-letter entries on construction, prepended to the live buffer", () => {
    const flushed: LogEntry[][] = [];
    const deadLetter = makeDeadLetter([makeEntry("recovered-1"), makeEntry("recovered-2")]);
    const queue = new BatchQueue({
      batchSize: 100,
      flushInterval: 10_000,
      deadLetter,
      onFlush: (e) => flushed.push(e),
    });

    queue.add(makeEntry("live-1"));
    const remaining = queue.flushAll();

    expect(remaining.map((e) => e.id)).toEqual(["recovered-1", "recovered-2", "live-1"]);
    // Recovery drains the dead-letter store so entries aren't replayed from there again.
    expect(deadLetter.size()).toBe(0);
  });

  test("skips dead-letter recovery when the store is empty", () => {
    const deadLetter = makeDeadLetter([]);
    const queue = new BatchQueue({ batchSize: 100, flushInterval: 10_000, deadLetter, onFlush: () => {} });

    expect(queue.flushAll()).toEqual([]);
  });
});
