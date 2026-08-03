import type { LogBatch, Transport } from "../core/types";

export interface WsTransportOptions {
  url: string;
  authToken?: string;
  /** Ping interval in ms to detect silent disconnects. Defaults to 30000 */
  heartbeatInterval?: number;
  /** Max ms to wait for an ACK before treating send as failed. Defaults to 5000 */
  ackTimeout?: number;
  /** Base reconnect delay in ms. Doubles each attempt, capped at 30s. Defaults to 1000 */
  reconnectDelay?: number;
  silent?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

type PendingAck = {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type WsFrame =
  | { type: "batch"; batchId: string; payload: LogBatch }
  | { type: "ping" }
  | { type: "auth"; token: string };

type ServerFrame =
  | { type: "ack"; batchId: string }
  | { type: "pong" }
  | { type: "error"; message: string };

// Platform-agnostic WebSocket factory
// In Node <22, globalThis.WebSocket may not exist — caller can inject one
type WsFactory = (url: string) => WebSocket;

let _batchCounter = 0;
function makeBatchId(): string {
  return `b-${Date.now().toString(36)}-${(++_batchCounter).toString(36)}`;
}

export class WsTransport implements Transport {
  private ws: WebSocket | null = null;
  private state: "disconnected" | "connecting" | "connected" = "disconnected";
  private readonly pendingAcks = new Map<string, PendingAck>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private destroyed = false;

  private readonly url: string;
  private readonly authToken?: string;
  private readonly heartbeatInterval: number;
  private readonly ackTimeout: number;
  private readonly reconnectDelay: number;
  private readonly silent: boolean;
  private readonly wsFactory: WsFactory;
  readonly onConnect?: () => void;
  readonly onDisconnect?: () => void;

  constructor(opts: WsTransportOptions & { wsFactory?: WsFactory }) {
    this.url = opts.url;
    this.authToken = opts.authToken;
    this.heartbeatInterval = opts.heartbeatInterval ?? 30_000;
    this.ackTimeout = opts.ackTimeout ?? 5_000;
    this.reconnectDelay = opts.reconnectDelay ?? 1_000;
    this.silent = opts.silent ?? false;
    this.onConnect = opts.onConnect;
    this.onDisconnect = opts.onDisconnect;
    this.wsFactory = opts.wsFactory ?? ((url) => new WebSocket(url));

    this.connect();
  }

  // ─── Transport interface ──────────────────────────────────────────────────

  async send(batch: LogBatch): Promise<void> {
    await this.waitForReady();

    const batchId = makeBatchId();
    const frame: WsFrame = { type: "batch", batchId, payload: batch };

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(batchId);
        reject(new Error(`[goatlogger] ACK timeout for batch ${batchId}`));
      }, this.ackTimeout);

      this.pendingAcks.set(batchId, { resolve, reject, timer });

      try {
        this.ws!.send(JSON.stringify(frame));
      } catch (err) {
        clearTimeout(timer);
        this.pendingAcks.delete(batchId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  flush(): void {
    this.destroy();
  }

  // ─── Connection management ────────────────────────────────────────────────

  private connect(): void {
    if (this.destroyed || this.state === "connecting") return;
    this.state = "connecting";

    try {
      const ws = this.wsFactory(this.url);
      this.ws = ws;

      ws.onopen = () => {
        this.state = "connected";
        this.reconnectAttempt = 0;

        // Authenticate immediately after connect
        if (this.authToken) {
          ws.send(JSON.stringify({ type: "auth", token: this.authToken } satisfies WsFrame));
        }

        this.startHeartbeat();
        this.onConnect?.();
        if (!this.silent) console.log("[goatlogger] ws connected");
      };

      ws.onmessage = (event) => {
        this.handleFrame(event.data as string);
      };

      ws.onclose = (event) => {
        this.handleDisconnect(`closed (code=${event.code})`);
      };

      ws.onerror = () => {
        // onerror is always followed by onclose — handle there
        if (!this.silent) console.warn("[goatlogger] ws socket error");
      };
    } catch (err) {
      this.handleDisconnect(`connect threw: ${String(err)}`);
    }
  }

  private handleFrame(raw: string): void {
    let frame: ServerFrame;
    try {
      frame = JSON.parse(raw) as ServerFrame;
    } catch {
      return;
    }

    if (frame.type === "ack") {
      const pending = this.pendingAcks.get(frame.batchId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingAcks.delete(frame.batchId);
        pending.resolve();
      }
    } else if (frame.type === "pong") {
      // heartbeat acknowledged — connection is alive
    } else if (frame.type === "error") {
      if (!this.silent) console.error("[goatlogger] ws server error:", frame.message);
    }
  }

  private handleDisconnect(reason: string): void {
    this.state = "disconnected";
    this.stopHeartbeat();
    this.ws = null;

    // Reject all pending ACKs so callers can retry via dead-letter
    for (const [id, pending] of this.pendingAcks) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`[goatlogger] ws disconnected: ${reason}`));
      this.pendingAcks.delete(id);
    }

    this.onDisconnect?.();

    if (!this.destroyed) {
      const delay = Math.min(
        this.reconnectDelay * Math.pow(2, this.reconnectAttempt),
        30_000
      );
      this.reconnectAttempt++;

      if (!this.silent) {
        console.warn(`[goatlogger] ws ${reason} — reconnecting in ${delay}ms`);
      }

      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" } satisfies WsFrame));
      }
    }, this.heartbeatInterval);

    if (typeof this.heartbeatTimer === "object" && "unref" in this.heartbeatTimer) {
      (this.heartbeatTimer as NodeJS.Timeout).unref();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Wait until socket is open, up to ackTimeout ms */
  private waitForReady(): Promise<void> {
    if (this.state === "connected" && this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("[goatlogger] ws not ready — transport unavailable")),
        this.ackTimeout
      );
      const poll = setInterval(() => {
        if (this.state === "connected" && this.ws?.readyState === WebSocket.OPEN) {
          clearTimeout(deadline);
          clearInterval(poll);
          resolve();
        }
      }, 50);
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close(1000, "shutdown");
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.state === "connected";
  }
}

export function createWsTransport(
  opts: WsTransportOptions & { wsFactory?: WsFactory }
): WsTransport {
  return new WsTransport(opts);
}
