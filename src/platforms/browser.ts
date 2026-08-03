import { GoatLogger } from "../core/logger";
import { createAutoTransport } from "../transport/auto";
import { withBeaconFallback } from "../transport/beacon";
import { createHttpTransport } from "../transport/http";
import { createStoragePersistence } from "../persistence/storage";
import type { GoatLoggerConfig } from "../core/types";

export type { GoatLoggerConfig, LogEntry, LogLevel, LogBatch, TransportMode } from "../core/types";

export function createLogger(config: GoatLoggerConfig): GoatLogger {
  const auto = createAutoTransport({ config });

  // Wrap with beacon fallback for last-gasp HTTP delivery on page close
  const http = createHttpTransport(config);
  const beaconWrapped = withBeaconFallback(http, config.endpoint, config.authToken);

  // The main transport is auto (ws/http), beacon is only used on unload
  const persistence = createStoragePersistence();

  const logger = new GoatLogger({
    config,
    transport: auto,
    persistence,
    platform: "browser",
  });

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        logger.shutdown();
      }
    });
  }

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
      const entries = logger.flushAll();
      if (entries.length > 0) {
        beaconWrapped.beacon({ entries, sentAt: new Date().toISOString() });
      }
    });
  }

  return logger;
}
