import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createLogger } from "./node";

let fetchSpy: ReturnType<typeof spyOn> | null = null;
let processOnceSpy: ReturnType<typeof spyOn> | null = null;
let processOnSpy: ReturnType<typeof spyOn> | null = null;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = null;
  processOnceSpy?.mockRestore();
  processOnceSpy = null;
  processOnSpy?.mockRestore();
  processOnSpy = null;
});

describe("node createLogger — HTTP wiring", () => {
  test("logs are delivered over HTTP to the configured endpoint", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    // spyOn(process, ...) still registers the real listeners — harmless since we never
    // emit the signals — but stub it out anyway to keep this test focused on HTTP wiring.
    processOnceSpy = spyOn(process, "once");
    processOnSpy = spyOn(process, "on");

    const logger = createLogger({
      endpoint: "https://logs.example.com/ingest",
      service: "node-test",
      silent: true,
      batchSize: 1,
    });

    logger.info("from node platform");
    await logger.shutdown();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://logs.example.com/ingest");
    const body = JSON.parse(init.body as string);
    expect(body.entries[0].message).toBe("from node platform");
  });
});

describe("node createLogger — process lifecycle wiring", () => {
  test("registers SIGTERM/SIGINT handlers and an uncaughtException handler", () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    processOnceSpy = spyOn(process, "once");
    processOnSpy = spyOn(process, "on");

    createLogger({ endpoint: "https://logs.example.com/ingest", service: "node-test", silent: true });

    const onceEvents = processOnceSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(onceEvents).toContain("SIGTERM");
    expect(onceEvents).toContain("SIGINT");

    const onEvents = processOnSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(onEvents).toContain("uncaughtException");
  });
});

// Note: node.ts's "Node <22 without global WebSocket" fallback (delete WebSocket, expect
// `require('ws')` to fail and warn) isn't covered here — Bun ships a built-in shim that
// resolves `require('ws')` successfully even though the package isn't installed, so that
// branch can't be reproduced without either mocking `require` itself or letting the
// resulting transport attempt a real network connection. Neither is worth the flakiness.
