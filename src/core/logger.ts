import type {
  GoatLoggerConfig,
  LogBatch,
  LogEntry,
  LogLevel,
  Persistence,
  Transport,
} from "./types";
import { BatchQueue } from "./queue";
import { withRetry } from "./retry";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

const CONSOLE_METHOD: Record<LogLevel, "debug" | "info" | "warn" | "error"> = {
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
  fatal: "error",
};

export interface GoatLoggerOptions {
  config: GoatLoggerConfig;
  /** Omit for local-only mode: console output only, no batching/network/persistence */
  transport?: Transport;
  persistence?: Persistence;
  platform: "browser" | "node";
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class GoatLogger {
  private readonly config: GoatLoggerConfig;
  private readonly transport?: Transport;
  private readonly persistence?: Persistence;
  private readonly platform: "browser" | "node";
  private readonly minLevel: LogLevel;
  private readonly sessionId = makeSessionId();
  private readonly queue?: BatchQueue;
  private pendingSend: Promise<void> = Promise.resolve();

  constructor(opts: GoatLoggerOptions) {
    this.config = opts.config;
    this.transport = opts.transport;
    this.persistence = opts.persistence;
    this.platform = opts.platform;
    this.minLevel = opts.config.minLevel ?? "debug";

    // No transport => local-only mode. Console output happens in log(), no
    // BatchQueue/retry/dead-letter machinery is needed since there's nothing to send.
    if (this.transport) {
      this.queue = new BatchQueue({
        batchSize: opts.config.batchSize ?? 20,
        flushInterval: opts.config.flushInterval ?? 500,
        onFlush: (entries) => {
          this.pendingSend = this.send(entries);
        },
      });
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  fatal(message: string, data?: Record<string, unknown>): void {
    this.log("fatal", message, data);
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) return;

    const entry: LogEntry = {
      id: makeId(),
      level,
      message,
      data,
      timestamp: new Date().toISOString(),
      service: this.config.service,
      sessionId: this.sessionId,
      platform: this.platform,
    };

    if (!this.config.silent) {
      const method = CONSOLE_METHOD[level];
      console[method](
        `[${entry.timestamp}] [${entry.service}] [${level.toUpperCase()}] ${message}`,
        data ?? ""
      );
    }

    this.queue?.add(entry);
  }

  private async send(entries: LogEntry[]): Promise<void> {
    if (!this.transport) return;

    // Replay any dead-lettered entries from a prior failed flush alongside this one
    let outgoing = entries;
    const deadLetterSize = this.persistence?.size() ?? 0;
    if (deadLetterSize > 0) {
      outgoing = [...this.persistence!.dequeue(deadLetterSize), ...entries];
    }
    if (outgoing.length === 0) return;

    const batch: LogBatch = { entries: outgoing, sentAt: new Date().toISOString() };

    try {
      await withRetry(() => this.transport!.send(batch), {
        maxRetries: this.config.maxRetries ?? 5,
        retryDelay: this.config.retryDelay ?? 1000,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.persistence?.enqueue(outgoing);
      this.config.onDropped?.(outgoing, reason);
      if (!this.config.silent) {
        console.warn(
          `[goatlogger] dropped ${outgoing.length} entries after retries: ${reason}`
        );
      }
    }
  }

  async shutdown(): Promise<void> {
    if (!this.queue) return;
    this.queue.destroy();
    await this.pendingSend;
    this.transport?.flush?.();
  }

  /** Grabs everything currently buffered (queue + dead-letter) without sending it — for beacon-on-unload use. */
  drainForBeacon(): LogEntry[] {
    if (!this.queue) return [];
    const queued = this.queue.drain();
    const deadLetterSize = this.persistence?.size() ?? 0;
    const deadLettered = deadLetterSize > 0 ? this.persistence!.dequeue(deadLetterSize) : [];
    return [...deadLettered, ...queued];
  }
}
