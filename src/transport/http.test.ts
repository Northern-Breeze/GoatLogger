import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createHttpTransport } from "./http";
import type { GoatLoggerConfig, LogBatch } from "../core/types";

function baseConfig(overrides: Partial<GoatLoggerConfig> = {}): GoatLoggerConfig {
  return { endpoint: "https://logs.example.com/ingest", service: "test-service", ...overrides };
}

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

let fetchSpy: ReturnType<typeof spyOn> | null = null;
afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = null;
});

describe("createHttpTransport", () => {
  test("throws before attempting a request when no endpoint is configured", async () => {
    fetchSpy = spyOn(globalThis, "fetch");
    const transport = createHttpTransport(baseConfig({ endpoint: "" }));

    await expect(transport.send(sampleBatch())).rejects.toThrow("requires an endpoint");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("POSTs the batch as JSON to the configured endpoint", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const transport = createHttpTransport(baseConfig());
    const batch = sampleBatch();

    await transport.send(batch);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://logs.example.com/ingest");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(batch);
  });

  test("sets Content-Type and omits Authorization when no authToken is configured", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const transport = createHttpTransport(baseConfig());

    await transport.send(sampleBatch());

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBeUndefined();
  });

  test("sends the authToken as a Bearer header when configured", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const transport = createHttpTransport(baseConfig({ authToken: "secret-token" }));

    await transport.send(sampleBatch());

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-token");
  });

  test("merges custom headers into the request", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const transport = createHttpTransport(baseConfig({ headers: { "X-Tenant": "acme" } }));

    await transport.send(sampleBatch());

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Tenant"]).toBe("acme");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  test("throws a descriptive error when the server responds with a non-2xx status", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 503, statusText: "Service Unavailable" })
    );
    const transport = createHttpTransport(baseConfig());

    await expect(transport.send(sampleBatch())).rejects.toThrow("503 Service Unavailable");
  });

  test("resolves without throwing on a 2xx response", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const transport = createHttpTransport(baseConfig());

    await expect(transport.send(sampleBatch())).resolves.toBeUndefined();
  });
});
