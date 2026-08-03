var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/core/queue.ts
var BatchQueue = class {
  constructor(opts) {
    this.buffer = [];
    this.timer = null;
    this.destroyed = false;
    this.batchSize = opts.batchSize;
    this.flushInterval = opts.flushInterval;
    this.onFlush = opts.onFlush;
    const recoverable = opts.deadLetter?.size() ?? 0;
    if (opts.deadLetter && recoverable > 0) {
      this.buffer.push(...opts.deadLetter.dequeue(recoverable));
    }
  }
  add(entry) {
    if (this.destroyed) return;
    this.buffer.push(entry);
    if (this.buffer.length >= this.batchSize) {
      this.flush();
      return;
    }
    this.scheduleFlush();
  }
  flush() {
    this.clearTimer();
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    this.onFlush(batch);
  }
  /** Stops the timer and synchronously returns all remaining buffered entries. */
  flushAll() {
    this.clearTimer();
    this.destroyed = true;
    const batch = this.buffer;
    this.buffer = [];
    return batch;
  }
  scheduleFlush() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.flushInterval);
    if (typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref();
    }
  }
  clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
};

// src/core/retry.ts
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function withRetry(fn, opts) {
  const attempts = Math.max(1, opts.maxRetries);
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastErr = error;
      if (attempt === attempts) break;
      opts.onRetry?.(attempt, error);
      await sleep(opts.baseDelay * 2 ** attempt + Math.random() * 200);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// src/core/logger.ts
var LEVEL_RANK = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4
};
function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function makeSessionId() {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
var GoatLogger = class {
  constructor(opts) {
    this.sessionId = makeSessionId();
    this.pendingSend = Promise.resolve();
    this.config = opts.config;
    this.transport = opts.transport;
    this.persistence = opts.persistence;
    this.platform = opts.platform;
    this.minLevel = opts.config.minLevel ?? "debug";
    this.queue = new BatchQueue({
      batchSize: opts.config.batchSize ?? 20,
      flushInterval: opts.config.flushInterval ?? 500,
      deadLetter: this.persistence,
      onFlush: (entries) => {
        this.pendingSend = this.sendBatch(entries);
      }
    });
  }
  debug(message, data) {
    this.log("debug", message, data);
  }
  info(message, data) {
    this.log("info", message, data);
  }
  warn(message, data) {
    this.log("warn", message, data);
  }
  error(message, data) {
    this.log("error", message, data);
  }
  fatal(message, data) {
    this.log("fatal", message, data);
  }
  log(level, message, data) {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) return;
    const entry = {
      id: makeId(),
      level,
      message,
      data,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      service: this.config.service,
      sessionId: this.sessionId,
      platform: this.platform
    };
    if (!this.config.silent) {
      const line = `[${entry.timestamp}] [${entry.service}] [${level.toUpperCase()}] ${message}`;
      if (level === "error" || level === "fatal") {
        console.error(line, data ?? "");
      } else if (level === "warn") {
        console.warn(line, data ?? "");
      } else {
        console.log(line, data ?? "");
      }
    }
    this.queue.add(entry);
  }
  async sendBatch(entries) {
    if (entries.length === 0) return;
    const batch = { entries, sentAt: (/* @__PURE__ */ new Date()).toISOString() };
    try {
      await withRetry(() => this.transport.send(batch), {
        maxRetries: this.config.maxRetries ?? 5,
        baseDelay: this.config.retryDelay ?? 1e3,
        onRetry: (attempt, error) => {
          if (!this.config.silent) {
            console.warn(`[goatlogger] retry ${attempt} failed: ${error.message}`);
          }
        }
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.persistence.enqueue(entries);
      this.config.onDropped?.(entries, reason);
      if (!this.config.silent) {
        console.warn(
          `[goatlogger] dropped ${entries.length} entries after retries: ${reason}`
        );
      }
    }
  }
  /** Stops the batch timer and synchronously returns all buffered entries without sending them. */
  flushAll() {
    return this.queue.flushAll();
  }
  async shutdown() {
    await this.pendingSend;
    const remaining = this.flushAll();
    await this.sendBatch(remaining);
    this.transport.flush?.();
  }
};

// src/transport/websocket.ts
var _batchCounter = 0;
function makeBatchId() {
  return `b-${Date.now().toString(36)}-${(++_batchCounter).toString(36)}`;
}
var WsTransport = class {
  constructor(opts) {
    this.ws = null;
    this.state = "disconnected";
    this.pendingAcks = /* @__PURE__ */ new Map();
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.destroyed = false;
    this.url = opts.url;
    this.authToken = opts.authToken;
    this.heartbeatInterval = opts.heartbeatInterval ?? 3e4;
    this.ackTimeout = opts.ackTimeout ?? 5e3;
    this.reconnectDelay = opts.reconnectDelay ?? 1e3;
    this.silent = opts.silent ?? false;
    this.onConnect = opts.onConnect;
    this.onDisconnect = opts.onDisconnect;
    this.wsFactory = opts.wsFactory ?? ((url) => new WebSocket(url));
    this.connect();
  }
  // ─── Transport interface ──────────────────────────────────────────────────
  async send(batch) {
    await this.waitForReady();
    const batchId = makeBatchId();
    const frame = { type: "batch", batchId, payload: batch };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(batchId);
        reject(new Error(`[goatlogger] ACK timeout for batch ${batchId}`));
      }, this.ackTimeout);
      this.pendingAcks.set(batchId, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify(frame));
      } catch (err) {
        clearTimeout(timer);
        this.pendingAcks.delete(batchId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
  flush() {
    this.destroy();
  }
  // ─── Connection management ────────────────────────────────────────────────
  connect() {
    if (this.destroyed || this.state === "connecting") return;
    this.state = "connecting";
    try {
      const ws = this.wsFactory(this.url);
      this.ws = ws;
      ws.onopen = () => {
        this.state = "connected";
        this.reconnectAttempt = 0;
        if (this.authToken) {
          ws.send(JSON.stringify({ type: "auth", token: this.authToken }));
        }
        this.startHeartbeat();
        this.onConnect?.();
        if (!this.silent) console.log("[goatlogger] ws connected");
      };
      ws.onmessage = (event) => {
        this.handleFrame(event.data);
      };
      ws.onclose = (event) => {
        this.handleDisconnect(`closed (code=${event.code})`);
      };
      ws.onerror = () => {
        if (!this.silent) console.warn("[goatlogger] ws socket error");
      };
    } catch (err) {
      this.handleDisconnect(`connect threw: ${String(err)}`);
    }
  }
  handleFrame(raw) {
    let frame;
    try {
      frame = JSON.parse(raw);
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
    } else if (frame.type === "pong") ; else if (frame.type === "error") {
      if (!this.silent) console.error("[goatlogger] ws server error:", frame.message);
    }
  }
  handleDisconnect(reason) {
    this.state = "disconnected";
    this.stopHeartbeat();
    this.ws = null;
    for (const [id, pending] of this.pendingAcks) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`[goatlogger] ws disconnected: ${reason}`));
      this.pendingAcks.delete(id);
    }
    this.onDisconnect?.();
    if (!this.destroyed) {
      const delay = Math.min(
        this.reconnectDelay * Math.pow(2, this.reconnectAttempt),
        3e4
      );
      this.reconnectAttempt++;
      if (!this.silent) {
        console.warn(`[goatlogger] ws ${reason} \u2014 reconnecting in ${delay}ms`);
      }
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }
  }
  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, this.heartbeatInterval);
    if (typeof this.heartbeatTimer === "object" && "unref" in this.heartbeatTimer) {
      this.heartbeatTimer.unref();
    }
  }
  stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  /** Wait until socket is open, up to ackTimeout ms */
  waitForReady() {
    if (this.state === "connected" && this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("[goatlogger] ws not ready \u2014 transport unavailable")),
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
  destroy() {
    this.destroyed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close(1e3, "shutdown");
    this.ws = null;
  }
  get isConnected() {
    return this.state === "connected";
  }
};
function createWsTransport(opts) {
  return new WsTransport(opts);
}

// src/transport/http.ts
function createHttpTransport(config) {
  return {
    async send(batch) {
      if (!config.endpoint) {
        throw new Error("[goatlogger] HTTP transport requires an endpoint");
      }
      const headers = {
        "Content-Type": "application/json",
        ...config.headers
      };
      if (config.authToken) {
        headers.Authorization = `Bearer ${config.authToken}`;
      }
      const res = await fetch(config.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(batch)
      });
      if (!res.ok) {
        throw new Error(`[goatlogger] HTTP ingest failed: ${res.status} ${res.statusText}`);
      }
    }
  };
}

// src/transport/auto.ts
function createAutoTransport(opts) {
  const { config, wsFactory } = opts;
  const mode = config.transport ?? (config.wsEndpoint ? "auto" : "http");
  const http = createHttpTransport(config);
  if (mode === "http") return http;
  if (!config.wsEndpoint) {
    throw new Error("[goatlogger] transport:'ws' requires wsEndpoint to be set");
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
    }
  });
  if (mode === "ws") return ws;
  return {
    async send(batch) {
      if (ws.isConnected) {
        try {
          await ws.send(batch);
          return;
        } catch {
        }
      }
      await http.send(batch);
    },
    flush() {
      ws.flush();
    }
  };
}

// src/persistence/memory.ts
function createMemoryPersistence() {
  let buffer = [];
  return {
    enqueue(entries) {
      buffer.push(...entries);
    },
    dequeue(max) {
      const taken = buffer.slice(0, max);
      buffer = buffer.slice(max);
      return taken;
    },
    size() {
      return buffer.length;
    },
    clear() {
      buffer = [];
    }
  };
}

// src/platforms/node.ts
function createLogger(config) {
  let wsFactory;
  if (typeof WebSocket === "undefined") {
    try {
      const { WebSocket: NodeWS } = __require("ws");
      wsFactory = (url) => new NodeWS(url);
      if (!config.silent) {
        console.log("[goatlogger] using 'ws' package for WebSocket");
      }
    } catch {
      if (!config.silent && (config.transport === "ws" || config.transport === "auto")) {
        console.warn(
          "[goatlogger] WebSocket unavailable on this Node version. Install 'ws' package or upgrade to Node 22+. Falling back to HTTP."
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
    platform: "node"
  });
  const shutdown = async (signal) => {
    if (!config.silent) console.log(`[goatlogger] flushing on ${signal}...`);
    await logger.shutdown();
    process.exit(0);
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.on("uncaughtException", (err) => {
    logger.fatal("Uncaught exception", { message: err.message, stack: err.stack });
    setTimeout(() => process.exit(1), 2e3);
  });
  return logger;
}

export { createLogger };
//# sourceMappingURL=node.js.map
//# sourceMappingURL=node.js.map