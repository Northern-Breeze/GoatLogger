import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { GoatLogger } from "./logger";
import { withImmediateTimers } from "../test-support/fake-timers";
import type { GoatLoggerConfig, LogBatch, LogEntry, Persistence, Transport } from "./types";

function stubTransport(impl?: (batch: LogBatch) => Promise<void>) {
  return {
    send: mock(impl ?? (async () => {})),
    flush: mock(() => {}),
  } satisfies Transport;
}

function stubPersistence() {
  return {
    enqueue: mock((_entries: LogEntry[]) => {}),
    dequeue: mock((_max: number): LogEntry[] => []),
    size: mock(() => 0),
    clear: mock(() => {}),
  } satisfies Persistence;
}

function makeLogger(
  configOverrides: Partial<GoatLoggerConfig> = {},
  transport: ReturnType<typeof stubTransport> = stubTransport(),
  persistence: ReturnType<typeof stubPersistence> = stubPersistence()
) {
  const config: GoatLoggerConfig = {
    endpoint: "https://logs.example.com/ingest",
    service: "test-service",
    silent: true,
    // batchSize:1 makes every log() call flush (and thus sendBatch) immediately and
    // deterministically, instead of waiting on flushInterval's real timer.
    batchSize: 1,
    ...configOverrides,
  };
  const logger = new GoatLogger({ config, transport, persistence, platform: "node" });
  return { logger, transport, persistence };
}

const consoleSpies: Array<ReturnType<typeof spyOn>> = [];
afterEach(() => {
  while (consoleSpies.length > 0) consoleSpies.pop()!.mockRestore();
});

function silenceConsole() {
  for (const method of ["log", "warn", "error"] as const) {
    consoleSpies.push(spyOn(console, method).mockImplementation(() => {}));
  }
}

describe("GoatLogger — entry shape", () => {
  test("builds entries with the configured service/platform and an ISO timestamp", async () => {
    const sendCalls: LogBatch[] = [];
    const { logger } = makeLogger({}, stubTransport(async (b) => void sendCalls.push(b)));

    logger.info("hello", { a: 1 });
    await logger.shutdown();

    expect(sendCalls.length).toBe(1);
    const [entry] = sendCalls[0]!.entries;
    expect(entry).toMatchObject({ level: "info", message: "hello", data: { a: 1 }, service: "test-service", platform: "node" });
    expect(entry!.id).toBeTruthy();
    expect(() => new Date(entry!.timestamp).toISOString()).not.toThrow();
    expect(new Date(entry!.timestamp).toISOString()).toBe(entry!.timestamp);
  });

  test("uses one stable sessionId across multiple log calls from the same logger", async () => {
    const sendCalls: LogBatch[] = [];
    const { logger } = makeLogger({}, stubTransport(async (b) => void sendCalls.push(b)));

    logger.info("first");
    logger.info("second");
    await logger.shutdown();

    const sessionIds = new Set(sendCalls.flatMap((b) => b.entries.map((e) => e.sessionId)));
    expect(sessionIds.size).toBe(1);
  });

  test("each debug/info/warn/error/fatal helper tags the entry with the matching level", async () => {
    const sendCalls: LogBatch[] = [];
    const { logger } = makeLogger({}, stubTransport(async (b) => void sendCalls.push(b)));

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    logger.fatal("f");
    await logger.shutdown();

    const levels = sendCalls.flatMap((b) => b.entries.map((e) => e.level));
    expect(levels).toEqual(["debug", "info", "warn", "error", "fatal"]);
  });
});

describe("GoatLogger — level filtering", () => {
  test("defaults to minLevel 'debug', which allows every level through", async () => {
    const sendCalls: LogBatch[] = [];
    const { logger } = makeLogger({}, stubTransport(async (b) => void sendCalls.push(b)));

    logger.debug("shows up");
    await logger.shutdown();

    expect(sendCalls.length).toBe(1);
  });

  test("drops entries below the configured minLevel", async () => {
    const sendCalls: LogBatch[] = [];
    const { logger } = makeLogger({ minLevel: "warn" }, stubTransport(async (b) => void sendCalls.push(b)));

    logger.debug("dropped");
    logger.info("dropped");
    logger.warn("kept");
    logger.error("kept");
    await logger.shutdown();

    const messages = sendCalls.flatMap((b) => b.entries.map((e) => e.message));
    expect(messages).toEqual(["kept", "kept"]);
  });
});

describe("GoatLogger — console output", () => {
  test("silent:true suppresses all console output", () => {
    silenceConsole();
    const { logger } = makeLogger({ silent: true });

    logger.info("quiet");

    expect(console.log).not.toHaveBeenCalled();
  });

  test("debug/info log via console.log, warn via console.warn, error/fatal via console.error", () => {
    silenceConsole();
    const { logger } = makeLogger({ silent: false });

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    logger.fatal("f");

    expect(console.log).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe("GoatLogger — send outcomes", () => {
  test("on success, sends exactly one batch and never touches persistence or onDropped", async () => {
    const onDropped = mock((_entries: LogEntry[], _reason: string) => {});
    const { logger, transport, persistence } = makeLogger(
      { onDropped },
      stubTransport(async () => {})
    );

    logger.info("ok");
    await logger.shutdown();

    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(persistence.enqueue).not.toHaveBeenCalled();
    expect(onDropped).not.toHaveBeenCalled();
  });

  test("after retries are exhausted, failed entries go to persistence and onDropped fires with the reason", async () => {
    const onDropped = mock((_entries: LogEntry[], _reason: string) => {});
    const failing = stubTransport(async () => {
      throw new Error("ingest is down");
    });

    await withImmediateTimers(async () => {
      const { logger, persistence } = makeLogger(
        { maxRetries: 2, retryDelay: 1, onDropped },
        failing
      );

      logger.error("will be dropped");
      await logger.shutdown();

      expect(persistence.enqueue).toHaveBeenCalledTimes(1);
      const [droppedEntries] = persistence.enqueue.mock.calls[0] as [LogEntry[]];
      expect(droppedEntries.map((e) => e.message)).toEqual(["will be dropped"]);

      expect(onDropped).toHaveBeenCalledTimes(1);
      const [, reason] = onDropped.mock.calls[0] as [LogEntry[], string];
      expect(reason).toBe("ingest is down");
    });
  });

  test("retries the configured number of times before giving up", async () => {
    let attempts = 0;
    const flaky = stubTransport(async () => {
      attempts++;
      throw new Error("still failing");
    });

    await withImmediateTimers(async () => {
      const { logger } = makeLogger({ maxRetries: 4, retryDelay: 1 }, flaky);

      logger.error("retry me");
      await logger.shutdown();

      expect(attempts).toBe(4);
    });
  });
});

describe("GoatLogger — flushAll / shutdown", () => {
  test("flushAll() synchronously returns buffered entries without sending them", () => {
    const { logger, transport } = makeLogger({ batchSize: 100 });

    logger.info("buffered");
    const remaining = logger.flushAll();

    expect(remaining.map((e) => e.message)).toEqual(["buffered"]);
    expect(transport.send).not.toHaveBeenCalled();
  });

  test("shutdown() sends any remaining buffered entries and calls transport.flush()", async () => {
    const sendCalls: LogBatch[] = [];
    const { logger, transport } = makeLogger(
      { batchSize: 100 },
      stubTransport(async (b) => void sendCalls.push(b))
    );

    logger.info("never auto-flushed");
    await logger.shutdown();

    expect(sendCalls.length).toBe(1);
    expect(sendCalls[0]!.entries.map((e) => e.message)).toEqual(["never auto-flushed"]);
    expect(transport.flush).toHaveBeenCalledTimes(1);
  });

  test("shutdown() with nothing buffered still calls transport.flush() without sending an empty batch", async () => {
    const { logger, transport } = makeLogger();

    await logger.shutdown();

    expect(transport.send).not.toHaveBeenCalled();
    expect(transport.flush).toHaveBeenCalledTimes(1);
  });
});
