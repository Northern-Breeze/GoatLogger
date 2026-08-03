import { GoatLogger } from "../core/logger";
import { createAutoTransport } from "../transport/auto";
import { createMemoryPersistence } from "../persistence/memory";
import type { GoatLoggerConfig } from "../core/types";

export type { GoatLoggerConfig, LogEntry, LogLevel, LogBatch, TransportMode } from "../core/types";

export function createLogger(config: GoatLoggerConfig): GoatLogger {
  // Node <22 doesn't have globalThis.WebSocket — inject undici's or ws package if needed
  // Bun has WebSocket natively so this just works
  let wsFactory: ((url: string) => WebSocket) | undefined;

  if (typeof WebSocket === "undefined") {
    // Try to load 'ws' package at runtime without hard dep
    try {
      const { WebSocket: NodeWS } = require("ws");
      wsFactory = (url) => new NodeWS(url) as unknown as WebSocket;
      if (!config.silent) {
        console.log("[goatlogger] using 'ws' package for WebSocket");
      }
    } catch {
      if (!config.silent && (config.transport === "ws" || config.transport === "auto")) {
        console.warn(
          "[goatlogger] WebSocket unavailable on this Node version. " +
            "Install 'ws' package or upgrade to Node 22+. Falling back to HTTP."
        );
      }
    }
  }

  const transport = createAutoTransport({ config, wsFactory });
  const persistence = createMemoryPersistence();

  const logger = new GoatLogger({
    config,
    transport,
    persistence,
    platform: "node",
  });

  const shutdown = async (signal: string) => {
    if (!config.silent) console.log(`[goatlogger] flushing on ${signal}...`);
    await logger.shutdown();
    process.exit(0);
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    logger.fatal("Uncaught exception", { message: err.message, stack: err.stack });
    setTimeout(() => process.exit(1), 2000);
  });

  return logger;
}
