import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createAutoTransport } from "./auto";
import { createFakeWsFactory } from "../test-support/fake-websocket";
import { withImmediateTimers } from "../test-support/fake-timers";
import type { GoatLoggerConfig, LogBatch } from "../core/types";

function sampleBatch(): LogBatch {
  return {
    sentAt: "2024-01-01T00:00:00.000Z",
    entries: [
      {
        id: "1",
        level: "info",
        message: "hi",
        timestamp: "2024-01-01T00:00:00.000Z",
        service: "test-service",
        sessionId: "s-1",
        platform: "node",
      },
    ],
  };
}

function baseConfig(overrides: Partial<GoatLoggerConfig> = {}): GoatLoggerConfig {
  return { endpoint: "https://logs.example.com/ingest", service: "test-service", silent: true, ...overrides };
}

let fetchSpy: ReturnType<typeof spyOn> | null = null;
afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = null;
});

function mockFetchOk() {
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
}

describe("createAutoTransport — mode resolution", () => {
  test("defaults to HTTP when neither transport nor wsEndpoint is configured", async () => {
    mockFetchOk();
    const { factory } = createFakeWsFactory();
    const transport = createAutoTransport({ config: baseConfig(), wsFactory: factory });

    await transport.send(sampleBatch());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("transport:'http' stays HTTP-only even when wsEndpoint is set", async () => {
    mockFetchOk();
    const { factory, instances } = createFakeWsFactory();
    const transport = createAutoTransport({
      config: baseConfig({ transport: "http", wsEndpoint: "wss://logs.example.com/ws" }),
      wsFactory: factory,
    });

    await transport.send(sampleBatch());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(instances.length).toBe(0);
  });

  test("transport:'ws' throws synchronously if wsEndpoint is missing", () => {
    expect(() => createAutoTransport({ config: baseConfig({ transport: "ws" }) })).toThrow(
      "wsEndpoint to be set"
    );
  });

  test("transport:'auto' with no wsEndpoint also throws (nothing to fall back from)", () => {
    expect(() => createAutoTransport({ config: baseConfig({ transport: "auto" }) })).toThrow(
      "wsEndpoint to be set"
    );
  });

  test("transport:'ws' with wsEndpoint returns a WS-only transport, never touching HTTP", async () => {
    mockFetchOk();
    const { factory, instances } = createFakeWsFactory();
    const transport = createAutoTransport({
      config: baseConfig({ transport: "ws", wsEndpoint: "wss://logs.example.com/ws" }),
      wsFactory: factory,
    });
    instances[0]!.simulateOpen();

    const pending = transport.send(sampleBatch());
    await Promise.resolve();
    const frame = instances[0]!.lastSentFrame<{ type: string; batchId: string }>();
    instances[0]!.simulateMessage({ type: "ack", batchId: frame.batchId });
    await pending;

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("createAutoTransport — auto mode routing", () => {
  test("falls back to HTTP while the WS connection isn't open yet", async () => {
    mockFetchOk();
    const { factory, instances } = createFakeWsFactory();
    const transport = createAutoTransport({
      config: baseConfig({ transport: "auto", wsEndpoint: "wss://logs.example.com/ws" }),
      wsFactory: factory,
    });
    // instances[0] exists (constructed) but hasn't opened — isConnected is false.

    await transport.send(sampleBatch());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(instances[0]!.sent).toEqual([]);
  });

  test("routes through WS once connected, without touching HTTP", async () => {
    mockFetchOk();
    const { factory, instances } = createFakeWsFactory();
    const transport = createAutoTransport({
      config: baseConfig({ transport: "auto", wsEndpoint: "wss://logs.example.com/ws" }),
      wsFactory: factory,
    });
    instances[0]!.simulateOpen();

    const pending = transport.send(sampleBatch());
    await Promise.resolve();
    const frame = instances[0]!.lastSentFrame<{ type: string; batchId: string }>();
    instances[0]!.simulateMessage({ type: "ack", batchId: frame.batchId });
    await pending;

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("falls back to HTTP mid-flight if the WS send fails (e.g. ack times out)", async () => {
    mockFetchOk();
    await withImmediateTimers(async () => {
      const { factory, instances } = createFakeWsFactory();
      const transport = createAutoTransport({
        config: baseConfig({ transport: "auto", wsEndpoint: "wss://logs.example.com/ws" }),
        wsFactory: factory,
      });
      instances[0]!.simulateOpen();

      // No ack is ever delivered — the WS send rejects on its ackTimeout (accelerated to
      // ~0ms by withImmediateTimers), and auto should fall through to HTTP instead of
      // rejecting the caller.
      await transport.send(sampleBatch());

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  test("flush() tears down the underlying WS connection", () => {
    const { factory, instances } = createFakeWsFactory();
    const transport = createAutoTransport({
      config: baseConfig({ transport: "auto", wsEndpoint: "wss://logs.example.com/ws" }),
      wsFactory: factory,
    });
    instances[0]!.simulateOpen();

    transport.flush?.();

    expect(instances[0]!.closeCalls.length).toBe(1);
  });
});
