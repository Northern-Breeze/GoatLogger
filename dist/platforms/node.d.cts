type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
interface LogEntry {
    id: string;
    level: LogLevel;
    message: string;
    data?: Record<string, unknown>;
    timestamp: string;
    service: string;
    sessionId: string;
    platform: "browser" | "node";
}
interface LogBatch {
    entries: LogEntry[];
    sentAt: string;
}
type TransportMode = "http" | "ws" | "auto";
interface GoatLoggerConfig {
    /** Remote ingest HTTP endpoint URL. Always required. */
    endpoint: string;
    /** WebSocket ingest endpoint. Required for transport:'ws', optional for 'auto' */
    wsEndpoint?: string;
    /**
     * Transport strategy.
     * - 'http' — always HTTP (default if wsEndpoint omitted)
     * - 'ws'   — always WebSocket (wsEndpoint required)
     * - 'auto' — prefer WS when connected, fall back to HTTP automatically
     */
    transport?: TransportMode;
    /** Service/app name tag for all logs */
    service: string;
    /** Min level to log. Defaults to 'debug' */
    minLevel?: LogLevel;
    /** Max entries to batch before flushing. Defaults to 20 */
    batchSize?: number;
    /** Max ms to wait before flushing a partial batch. Defaults to 500 */
    flushInterval?: number;
    /** Max retry attempts on network failure. Defaults to 5 */
    maxRetries?: number;
    /** Initial retry delay in ms. Doubles each attempt. Defaults to 1000 */
    retryDelay?: number;
    /** Auth token — sent as Bearer header (HTTP) or auth frame (WS) */
    authToken?: string;
    /** Custom headers merged into every HTTP request */
    headers?: Record<string, string>;
    /** Called on unrecoverable send failure after all retries exhausted */
    onDropped?: (entries: LogEntry[], reason: string) => void;
    /** Suppress console output. Defaults to false */
    silent?: boolean;
}
interface Transport {
    send(batch: LogBatch): Promise<void>;
    /** Flush any pending state on exit/unload */
    flush?(): void;
}
interface Persistence {
    enqueue(entries: LogEntry[]): void;
    dequeue(max: number): LogEntry[];
    size(): number;
    clear(): void;
}

interface GoatLoggerOptions {
    config: GoatLoggerConfig;
    transport: Transport;
    persistence: Persistence;
    platform: "browser" | "node";
}
declare class GoatLogger {
    private readonly config;
    private readonly transport;
    private readonly persistence;
    private readonly platform;
    private readonly minLevel;
    private readonly sessionId;
    private readonly queue;
    private pendingSend;
    constructor(opts: GoatLoggerOptions);
    debug(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
    fatal(message: string, data?: Record<string, unknown>): void;
    private log;
    private sendBatch;
    /** Stops the batch timer and synchronously returns all buffered entries without sending them. */
    flushAll(): LogEntry[];
    shutdown(): Promise<void>;
}

declare function createLogger(config: GoatLoggerConfig): GoatLogger;

export { type GoatLoggerConfig, type LogBatch, type LogEntry, type LogLevel, type TransportMode, createLogger };
