import { afterEach, describe, expect, test } from "bun:test";
import { createStoragePersistence } from "./storage";
import { installFakeLocalStorage } from "../test-support/fake-storage";
import type { LogEntry } from "../core/types";

function makeEntry(id: string): LogEntry {
  return {
    id,
    level: "warn",
    message: `entry ${id}`,
    timestamp: new Date().toISOString(),
    service: "test-service",
    sessionId: "s-test",
    platform: "browser",
  };
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe("createStoragePersistence — without localStorage", () => {
  test("behaves as an empty, no-op store when localStorage is unavailable", () => {
    const store = createStoragePersistence();

    expect(store.size()).toBe(0);
    expect(() => store.enqueue([makeEntry("1")])).not.toThrow();
    expect(store.dequeue(10)).toEqual([]);
    expect(() => store.clear()).not.toThrow();
  });
});

describe("createStoragePersistence — with localStorage", () => {
  test("enqueue persists entries as JSON under the goatlogger key", () => {
    const fake = installFakeLocalStorage();
    restore = fake.restore;
    const store = createStoragePersistence();

    store.enqueue([makeEntry("1"), makeEntry("2")]);

    expect(store.size()).toBe(2);
    const raw = fake.storage.getItem("goatlogger:dead-letter");
    expect(JSON.parse(raw!).map((e: LogEntry) => e.id)).toEqual(["1", "2"]);
  });

  test("enqueue appends to existing entries rather than overwriting them", () => {
    const fake = installFakeLocalStorage();
    restore = fake.restore;
    const store = createStoragePersistence();

    store.enqueue([makeEntry("1")]);
    store.enqueue([makeEntry("2")]);

    expect(store.dequeue(10).map((e) => e.id)).toEqual(["1", "2"]);
  });

  test("enqueue with an empty array does not touch storage", () => {
    const fake = installFakeLocalStorage();
    restore = fake.restore;
    const store = createStoragePersistence();

    store.enqueue([]);

    expect(fake.storage.getItem("goatlogger:dead-letter")).toBeNull();
  });

  test("dequeue removes taken entries from storage, FIFO", () => {
    const fake = installFakeLocalStorage();
    restore = fake.restore;
    const store = createStoragePersistence();
    store.enqueue([makeEntry("1"), makeEntry("2"), makeEntry("3")]);

    const taken = store.dequeue(2);

    expect(taken.map((e) => e.id)).toEqual(["1", "2"]);
    expect(store.size()).toBe(1);
  });

  test("clear removes the storage key entirely", () => {
    const fake = installFakeLocalStorage();
    restore = fake.restore;
    const store = createStoragePersistence();
    store.enqueue([makeEntry("1")]);

    store.clear();

    expect(store.size()).toBe(0);
    expect(fake.storage.getItem("goatlogger:dead-letter")).toBeNull();
  });

  test("malformed JSON in storage is treated as an empty store instead of throwing", () => {
    const fake = installFakeLocalStorage();
    restore = fake.restore;
    fake.storage.setItem("goatlogger:dead-letter", "{not valid json");
    const store = createStoragePersistence();

    expect(store.size()).toBe(0);
    expect(store.dequeue(10)).toEqual([]);
  });

  test("a write failure (e.g. quota exceeded) is swallowed rather than thrown", () => {
    const fake = installFakeLocalStorage();
    restore = fake.restore;
    fake.storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const store = createStoragePersistence();

    expect(() => store.enqueue([makeEntry("1")])).not.toThrow();
  });
});
