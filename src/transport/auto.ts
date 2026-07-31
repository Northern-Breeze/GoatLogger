import { createWsTransport, WsTransport } from "./websocket";
import { createHttpTransport } from "./http";
import type { GoatLoggerConfig, LogBatch, Transport } from "../core/types";

export type TransportMode = "http" | "ws" | "auto";

export interface AutoTransportOptions {
  config: GoatLoggerConfig & { wsEndpoint?: string; transport?: TransportMode };
  /** Platform WebSocket factory — inject for Node <22 compatibility */
  wsFactory?: (url: string) => WebSocket;
}

/**
 * Auto transport:
 *   - 'http' → always HTTP
 *   - 'ws'   → always WS (throws if wsEndpoint missing)
 *   - 'auto' → prefer WS when connected, fall through to HTTP when not
 */
export function createAutoTransport(opts: AutoTransportOptions): Transport {
  const { config, wsFactory } = opts;
  const mode: TransportMode = config.transport ?? "auto";

  const http = createHttpTransport(config);

  // HTTP-only — short circuit
  if (mode === "http") return http;

  if (!config.wsEndpoint) {
    if (mode === "ws") {
      throw new Error("[goatlogger] transport:'ws' requires wsEndpoint to be set");
    }
    // auto but no wsEndpoint — just use HTTP
    return http;
  }

  const ws = createWsTransport({
    url: config.wsEndpoint,
    authToken: config.authToken,
    silent: config.silent,
    wsFactory,
    onConnect: () => {
      if (!config.silent) console.log("[goatlogger] transport: WS active");
    },
    onDisconnect: () => {
      if (!config.silent && mode === "auto") {
        console.log("[goatlogger] transport: WS down, falling back to HTTP");
      }
    },
  });

  if (mode === "ws") return ws;

  // auto: route through WS when connected, HTTP otherwise
  return {
    async send(batch: LogBatch): Promise<void> {
      if (ws.isConnected) {
        try {
          await ws.send(batch);
          return;
        } catch {
          // WS failed mid-flight — fall through to HTTP
        }
      }
      await http.send(batch);
    },

    flush(): void {
      ws.flush();
    },
  };
}
