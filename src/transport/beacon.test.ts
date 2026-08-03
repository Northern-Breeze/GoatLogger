import { afterEach, describe, expect, mock, test } from "bun:test";
import { withBeaconFallback } from "./beacon";
import type { LogBatch, Transport } from "../core/types";

function sampleBatch(entries: LogBatch["entries"] = [
  {
    id: "1",
    level: "fatal",
    message: "page closing",
    timestamp: "2024-01-01T00:00:00.000Z",
    service: "test-service",
    sessionId: "s-1",
    platform: "browser",
  },
]): LogBatch {
  return { sentAt: "2024-01-01T00:00:00.000Z", entries };
}

function stubTransport(): Transport & { sendCalls: LogBatch[]; flushCalls: number } {
  const sendCalls: LogBatch[] = [];
  let flushCalls = 0;
  return {
    sendCalls,
    get flushCalls() {
      return flushCalls;
    },
    async send(batch) {
      sendCalls.push(batch);
    },
    flush() {
      flushCalls++;
    },
  };
}

let previousSendBeacon: unknown;
let hadNavigator: boolean;
afterEach(() => {
  if (hadNavigator) {
    (globalThis.navigator as unknown as { sendBeacon?: unknown }).sendBeacon = previousSendBeacon;
  }
});

function installSendBeacon(impl: (url: string, data: BodyInit) => boolean) {
  hadNavigator = typeof globalThis.navigator !== "undefined";
  if (!hadNavigator) {
    (globalThis as { navigator?: unknown }).navigator = {};
  }
  previousSendBeacon = (globalThis.navigator as unknown as { sendBeacon?: unknown }).sendBeacon;
  (globalThis.navigator as unknown as { sendBeacon: unknown }).sendBeacon = mock(impl);
}

describe("withBeaconFallback", () => {
  test("send() and flush() delegate straight through to the wrapped transport", async () => {
    const inner = stubTransport();
    const wrapped = withBeaconFallback(inner, "https://logs.example.com/ingest");

    await wrapped.send(sampleBatch());
    wrapped.flush?.();

    expect(inner.sendCalls.length).toBe(1);
    expect(inner.flushCalls).toBe(1);
  });

  test("beacon() returns false when no endpoint is configured", () => {
    const wrapped = withBeaconFallback(stubTransport(), undefined);
    expect(wrapped.beacon(sampleBatch())).toBe(false);
  });

  test("beacon() returns false for an empty batch", () => {
    const wrapped = withBeaconFallback(stubTransport(), "https://logs.example.com/ingest");
    expect(wrapped.beacon(sampleBatch([]))).toBe(false);
  });

  test("beacon() returns false when navigator.sendBeacon is unavailable", () => {
    const wrapped = withBeaconFallback(stubTransport(), "https://logs.example.com/ingest");
    expect(wrapped.beacon(sampleBatch())).toBe(false);
  });

  test("beacon() posts to the plain endpoint when there's no authToken", () => {
    let calledUrl: string | undefined;
    installSendBeacon((url) => {
      calledUrl = url;
      return true;
    });
    const wrapped = withBeaconFallback(stubTransport(), "https://logs.example.com/ingest");

    const accepted = wrapped.beacon(sampleBatch());

    expect(accepted).toBe(true);
    expect(calledUrl).toBe("https://logs.example.com/ingest");
  });

  test("beacon() appends the authToken as a ?token= query param", () => {
    let calledUrl = "";
    installSendBeacon((url) => {
      calledUrl = url;
      return true;
    });
    const wrapped = withBeaconFallback(stubTransport(), "https://logs.example.com/ingest", "s3cr3t");

    wrapped.beacon(sampleBatch());

    expect(calledUrl).toBe("https://logs.example.com/ingest?token=s3cr3t");
  });

  test("beacon() uses & to join the token when the endpoint already has a query string", () => {
    let calledUrl = "";
    installSendBeacon((url) => {
      calledUrl = url;
      return true;
    });
    const wrapped = withBeaconFallback(stubTransport(), "https://logs.example.com/ingest?env=prod", "s3cr3t");

    wrapped.beacon(sampleBatch());

    expect(calledUrl).toBe("https://logs.example.com/ingest?env=prod&token=s3cr3t");
  });

  test("beacon() sends the batch as a JSON blob and returns the browser's acceptance", () => {
    let sentBody: BodyInit | null = null;
    installSendBeacon((_url, data) => {
      sentBody = data;
      return false;
    });
    const wrapped = withBeaconFallback(stubTransport(), "https://logs.example.com/ingest");
    const batch = sampleBatch();

    const accepted = wrapped.beacon(batch);

    expect(accepted).toBe(false);
    expect(sentBody).toBeInstanceOf(Blob);
    // The Blob constructor normalizes the MIME type (lowercases it, appends a default
    // charset) — assert the substring rather than an exact match against that spec detail.
    expect((sentBody as unknown as Blob).type).toContain("application/json");
  });
});
