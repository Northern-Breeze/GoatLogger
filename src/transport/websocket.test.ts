import { afterEach, describe, expect, test } from "bun:test";
import { createWsTransport, WsTransport } from "./websocket";
import { createFakeWsFactory, FakeWebSocket } from "../test-support/fake-websocket";
import { withImmediateTimers } from "../test-support/fake-timers";
import type { LogBatch } from "../core/types";

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

const active: WsTransport[] = [];

function makeTransport(overrides: Partial<Parameters<typeof createWsTransport>[0]> = {}) {
  const { factory, instances } = createFakeWsFactory();
  const transport = createWsTransport({
    url: "wss://logs.example.com/ws",
    ackTimeout: 50,
    heartbeatInterval: 30_000,
    reconnectDelay: 1000,
    silent: true,
    wsFactory: factory,
    ...overrides,
  });
  active.push(transport);
  return { transport, instances };
}

afterEach(() => {
  // Every socket's constructor schedules a heartbeat/reconnect timer — destroy() to
  // release them so an open handle doesn't keep `bun test` alive past this file.
  while (active.length > 0) active.pop()!.destroy();
});

describe("WsTransport — connection lifecycle", () => {
  test("connects immediately on construction", () => {
    const { instances } = makeTransport();
    expect(instances.length).toBe(1);
    expect(instances[0]?.url).toBe("wss://logs.example.com/ws");
  });

  test("sends an auth frame immediately on open when an authToken is configured", () => {
    const { instances } = makeTransport({ authToken: "s3cr3t" });
    instances[0]!.simulateOpen();

    expect(instances[0]!.lastSentFrame<{ type: string; token: string }>()).toEqual({
      type: "auth",
      token: "s3cr3t",
    });
  });

  test("sends no auth frame when no authToken is configured", () => {
    const { instances } = makeTransport();
    instances[0]!.simulateOpen();

    expect(instances[0]!.sent).toEqual([]);
  });

  test("calls onConnect on open and onDisconnect on close", () => {
    let connected = 0;
    let disconnected = 0;
    const { instances, transport } = makeTransport({
      onConnect: () => connected++,
      onDisconnect: () => disconnected++,
    });

    instances[0]!.simulateOpen();
    expect(connected).toBe(1);
    expect(transport.isConnected).toBe(true);

    instances[0]!.simulateClose();
    expect(disconnected).toBe(1);
    expect(transport.isConnected).toBe(false);
  });
});

describe("WsTransport — send / ack", () => {
  test("send() resolves once the matching ack frame arrives", async () => {
    const { instances, transport } = makeTransport();
    instances[0]!.simulateOpen();

    const pending = transport.send(sampleBatch());
    // send() is async and suspends at `await waitForReady()` — let that microtask
    // resolve before the frame actually reaches the socket.
    await Promise.resolve();
    const frame = instances[0]!.lastSentFrame<{ type: string; batchId: string }>();
    expect(frame.type).toBe("batch");

    instances[0]!.simulateMessage({ type: "ack", batchId: frame.batchId });

    await expect(pending).resolves.toBeUndefined();
  });

  test("send() rejects if no ack arrives before ackTimeout", async () => {
    const { instances, transport } = makeTransport({ ackTimeout: 20 });
    instances[0]!.simulateOpen();

    await expect(transport.send(sampleBatch())).rejects.toThrow("ACK timeout");
  });

  test("send() ignores acks for a different batchId", async () => {
    const { instances, transport } = makeTransport({ ackTimeout: 20 });
    instances[0]!.simulateOpen();

    const pending = transport.send(sampleBatch());
    await Promise.resolve();
    instances[0]!.simulateMessage({ type: "ack", batchId: "not-the-right-id" });

    await expect(pending).rejects.toThrow("ACK timeout");
  });

  test("send() waits for the socket to open before sending", async () => {
    const { instances, transport } = makeTransport({ ackTimeout: 500 });

    const pending = transport.send(sampleBatch());
    // Socket isn't open yet — nothing should have been written.
    expect(instances[0]!.sent).toEqual([]);

    setTimeout(() => instances[0]!.simulateOpen(), 10);
    // waitForReady() only re-checks readiness on its 50ms poll — wait past that tick.
    await new Promise((resolve) => setTimeout(resolve, 70));

    const frame = instances[0]!.lastSentFrame<{ type: string; batchId: string }>();
    expect(frame.type).toBe("batch");
    instances[0]!.simulateMessage({ type: "ack", batchId: frame.batchId });
    await expect(pending).resolves.toBeUndefined();
  });

  test("a server error frame does not resolve or reject a pending send", async () => {
    const { instances, transport } = makeTransport({ ackTimeout: 20 });
    instances[0]!.simulateOpen();

    const pending = transport.send(sampleBatch());
    instances[0]!.simulateMessage({ type: "error", message: "validation failed" });

    // The error frame is logged, not routed to the pending ack — it still times out.
    await expect(pending).rejects.toThrow("ACK timeout");
  });
});

describe("WsTransport — disconnect handling", () => {
  test("rejects all pending sends when the socket closes", async () => {
    const { instances, transport } = makeTransport({ ackTimeout: 5_000 });
    instances[0]!.simulateOpen();

    const pending = transport.send(sampleBatch());
    // Let send() register its pending ack before the connection drops.
    await Promise.resolve();
    instances[0]!.simulateClose(1006, "network drop");

    await expect(pending).rejects.toThrow("ws disconnected");
  });

  test("schedules a reconnect after disconnecting", async () => {
    await withImmediateTimers(async () => {
      const { instances } = makeTransport({ reconnectDelay: 1000 });
      instances[0]!.simulateOpen();
      instances[0]!.simulateClose();

      await new Promise((resolve) => setTimeout(resolve, 5));

      expect(instances.length).toBe(2);
      expect(instances[1]!.url).toBe("wss://logs.example.com/ws");
    });
  });

  test("destroy() closes the socket and stops further reconnects", async () => {
    await withImmediateTimers(async () => {
      const { instances, transport } = makeTransport({ reconnectDelay: 1000 });
      instances[0]!.simulateOpen();

      transport.destroy();

      expect(instances[0]!.closeCalls).toEqual([{ code: 1000, reason: "shutdown" }]);

      await new Promise((resolve) => setTimeout(resolve, 5));
      // destroy() suppresses the reconnect that a normal disconnect would schedule.
      expect(instances.length).toBe(1);
    });
  });

  test("flush() is an alias for destroy()", () => {
    const { instances, transport } = makeTransport();
    instances[0]!.simulateOpen();

    transport.flush();

    expect(instances[0]!.closeCalls.length).toBe(1);
    expect(transport.isConnected).toBe(false);
  });
});

describe("WsTransport — heartbeat", () => {
  test("pings the server on the configured interval while open", async () => {
    const { instances } = makeTransport({ heartbeatInterval: 15 });
    instances[0]!.simulateOpen();

    await new Promise((resolve) => setTimeout(resolve, 40));

    const pings = instances[0]!.sent.map((raw) => JSON.parse(raw)).filter((f) => f.type === "ping");
    expect(pings.length).toBeGreaterThan(0);
  });
});
