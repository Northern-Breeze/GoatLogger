import type { LogEntry } from "./types";

export interface BatchQueueOptions {
  /** Flush when the buffer reaches this many entries */
  batchSize: number;
  /** Flush a partial buffer after this many ms */
  flushInterval: number;
  onFlush: (entries: LogEntry[]) => void;
}

export class BatchQueue {
  private buffer: LogEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  private readonly batchSize: number;
  private readonly flushInterval: number;
  private readonly onFlush: (entries: LogEntry[]) => void;

  constructor(opts: BatchQueueOptions) {
    this.batchSize = opts.batchSize;
    this.flushInterval = opts.flushInterval;
    this.onFlush = opts.onFlush;
  }

  add(entry: LogEntry): void {
    if (this.destroyed) return;

    this.buffer.push(entry);
    if (this.buffer.length >= this.batchSize) {
      this.flush();
      return;
    }
    this.scheduleFlush();
  }

  flush(): void {
    this.clearTimer();
    if (this.buffer.length === 0) return;

    const batch = this.buffer;
    this.buffer = [];
    this.onFlush(batch);
  }

  destroy(): void {
    this.flush();
    this.destroyed = true;
    this.clearTimer();
  }

  /** Synchronously empty the buffer without routing through onFlush — for beacon-on-unload use. */
  drain(): LogEntry[] {
    this.clearTimer();
    const batch = this.buffer;
    this.buffer = [];
    return batch;
  }

  private scheduleFlush(): void {
    if (this.timer) return;

    this.timer = setTimeout(() => this.flush(), this.flushInterval);
    if (typeof this.timer === "object" && "unref" in this.timer) {
      (this.timer as NodeJS.Timeout).unref();
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
