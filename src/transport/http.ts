import type { GoatLoggerConfig, LogBatch, Transport } from "../core/types";

export function createHttpTransport(config: GoatLoggerConfig): Transport {
  return {
    async send(batch: LogBatch): Promise<void> {
      if (!config.endpoint) {
        throw new Error("[goatlogger] HTTP transport requires an endpoint");
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...config.headers,
      };
      if (config.authToken) {
        headers.Authorization = `Bearer ${config.authToken}`;
      }

      const res = await fetch(config.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        throw new Error(`[goatlogger] HTTP ingest failed: ${res.status} ${res.statusText}`);
      }
    },
  };
}
