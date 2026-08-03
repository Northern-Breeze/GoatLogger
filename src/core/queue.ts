import type { LogEntry, Persistence } from "./types";

export interface BatchQueueOptions {
  /** Flush when the buffer reaches this many entries */
  batchSize: number;
  /** Flush a partial buffer after this many ms */
  flushInterval: number;
  onFlush: (entries: LogEntry[]) => void;
  /** Checked once on construction; any recovered entries are prepended to the queue. */
  deadLetter?: Persistence;
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

    const recoverable = opts.deadLetter?.size() ?? 0;
    if (opts.deadLetter && recoverable > 0) {
      this.buffer.push(...opts.deadLetter.dequeue(recoverable));
    }
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

  /** Stops the timer and synchronously returns all remaining buffered entries. */
  flushAll(): LogEntry[] {
    this.clearTimer();
    this.destroyed = true;
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
