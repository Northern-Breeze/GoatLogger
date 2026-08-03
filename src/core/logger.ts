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

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

export interface GoatLoggerOptions {
  config: GoatLoggerConfig;
  transport: Transport;
  persistence: Persistence;
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
  private readonly transport: Transport;
  private readonly persistence: Persistence;
  private readonly platform: "browser" | "node";
  private readonly minLevel: LogLevel;
  private readonly sessionId = makeSessionId();
  private readonly queue: BatchQueue;
  private pendingSend: Promise<void> = Promise.resolve();

  constructor(opts: GoatLoggerOptions) {
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
      },
    });
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
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) return;

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

  private async sendBatch(entries: LogEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const batch: LogBatch = { entries, sentAt: new Date().toISOString() };

    try {
      await withRetry(() => this.transport.send(batch), {
        maxRetries: this.config.maxRetries ?? 5,
        baseDelay: this.config.retryDelay ?? 1000,
        onRetry: (attempt, error) => {
          if (!this.config.silent) {
            console.warn(`[goatlogger] retry ${attempt} failed: ${error.message}`);
          }
        },
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
  flushAll(): LogEntry[] {
    return this.queue.flushAll();
  }

  async shutdown(): Promise<void> {
    await this.pendingSend;
    const remaining = this.flushAll();
    await this.sendBatch(remaining);
    this.transport.flush?.();
  }
}
