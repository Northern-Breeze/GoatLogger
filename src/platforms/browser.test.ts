import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createLogger } from "./browser";

class FakeEventTarget {
  private listeners: Record<string, Array<() => void>> = {};

  addEventListener(type: string, handler: () => void): void {
    (this.listeners[type] ??= []).push(handler);
  }

  fire(type: string): void {
    for (const handler of this.listeners[type] ?? []) handler();
  }
}

let fetchSpy: ReturnType<typeof spyOn> | null = null;
let previousDocument: unknown;
let previousWindow: unknown;
let previousNavigator: unknown;
let hadDocument = false;
let hadWindow = false;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = null;

  const g = globalThis as Record<string, unknown>;
  if (hadDocument) g.document = previousDocument;
  else delete g.document;
  if (hadWindow) g.window = previousWindow;
  else delete g.window;
  g.navigator = previousNavigator;
  hadDocument = false;
  hadWindow = false;
});

function mockFetchOk() {
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
}

describe("browser createLogger — plain environment (no document/window)", () => {
  test("still returns a working HTTP-backed logger, without throwing", async () => {
    mockFetchOk();

    const logger = createLogger({
      endpoint: "https://logs.example.com/ingest",
      service: "browser-test",
      silent: true,
      batchSize: 1,
    });

    logger.info("no dom here");
    await logger.shutdown();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("browser createLogger — visibilitychange", () => {
  test("shuts the logger down when the tab becomes hidden", async () => {
    mockFetchOk();
    const fakeDocument = new FakeEventTarget() as unknown as Document & { visibilityState: string };
    fakeDocument.visibilityState = "visible";

    hadDocument = "document" in globalThis;
    previousDocument = (globalThis as Record<string, unknown>).document;
    (globalThis as Record<string, unknown>).document = fakeDocument;

    const logger = createLogger({
      endpoint: "https://logs.example.com/ingest",
      service: "browser-test",
      silent: true,
      batchSize: 100,
    });
    const shutdownSpy = spyOn(logger, "shutdown");

    logger.info("buffered, not yet flushed");
    fakeDocument.visibilityState = "hidden";
    (fakeDocument as unknown as FakeEventTarget).fire("visibilitychange");

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    await shutdownSpy.mock.results[0]!.value;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("does nothing while the tab stays visible", () => {
    const fakeDocument = new FakeEventTarget() as unknown as Document & { visibilityState: string };
    fakeDocument.visibilityState = "visible";

    hadDocument = "document" in globalThis;
    previousDocument = (globalThis as Record<string, unknown>).document;
    (globalThis as Record<string, unknown>).document = fakeDocument;

    const logger = createLogger({
      endpoint: "https://logs.example.com/ingest",
      service: "browser-test",
      silent: true,
    });
    const shutdownSpy = spyOn(logger, "shutdown");

    (fakeDocument as unknown as FakeEventTarget).fire("visibilitychange");

    expect(shutdownSpy).not.toHaveBeenCalled();
  });
});

describe("browser createLogger — beforeunload beacon", () => {
  test("sends buffered entries via sendBeacon when the page is closing", () => {
    const fakeWindow = new FakeEventTarget();
    hadWindow = "window" in globalThis;
    previousWindow = (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).window = fakeWindow;

    previousNavigator = globalThis.navigator;
    const sendBeacon = mock((_url: string, _data: BodyInit) => true);
    (globalThis as Record<string, unknown>).navigator = { sendBeacon };

    const logger = createLogger({
      endpoint: "https://logs.example.com/ingest",
      service: "browser-test",
      silent: true,
      batchSize: 100,
    });

    logger.fatal("page is closing");
    fakeWindow.fire("beforeunload");

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url] = sendBeacon.mock.calls[0]!;
    expect(url).toBe("https://logs.example.com/ingest");
  });

  test("does not call sendBeacon when nothing was buffered", () => {
    const fakeWindow = new FakeEventTarget();
    hadWindow = "window" in globalThis;
    previousWindow = (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).window = fakeWindow;

    previousNavigator = globalThis.navigator;
    const sendBeacon = mock((_url: string, _data: BodyInit) => true);
    (globalThis as Record<string, unknown>).navigator = { sendBeacon };

    createLogger({ endpoint: "https://logs.example.com/ingest", service: "browser-test", silent: true });

    fakeWindow.fire("beforeunload");

    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
