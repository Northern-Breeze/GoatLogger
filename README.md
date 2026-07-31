# 🐐 GoatLogger

Async, non-blocking logger SDK with remote ingest, automatic batching, exponential-backoff retry, and a dead-letter queue. Works on both browser and Node/Bun. Never blocks your hot path.

---

## Architecture

```
Your app
  │
  └─ logger.info('potatoes', { value: 2 })   ← synchronous, returns immediately
        │
        ▼
  In-memory BatchQueue
  (batches entries for 500ms or until 20 entries)
        │
        ▼
  Background sender
  ├─ HTTP POST /ingest  ──────────────────────────────────────────────────────┐
  │    retry w/ exponential backoff (5 attempts)                              │
  │    on total failure → Dead-Letter Queue                                   │
  │      browser: localStorage                                                │
  │      node:    in-memory (survives transient failures within process)      │
  │    replayed on next flush cycle                                           │
  └─ Beacon API (browser only, on page unload)                               │
                                                                              │
                                                            GoatLogger Server │
                                                                              │
                                                     POST /ingest ◄──────────┘
                                                       │ 202 Accepted immediately
                                                       ▼
                                                   BullMQ Queue (Redis)
                                                       │
                                                       ▼
                                                   Worker (async)
                                                   ├─ validate & enrich
                                                   ├─ normalise log level
                                                   └─ upsert to Postgres (idempotent)
```

---

## SDK Installation

```bash
npm install goatlogger
# or
bun add goatlogger
```

### Browser usage

```ts
import { createLogger } from 'goatlogger/browser'

const logger = createLogger({
  endpoint: 'https://logs.yourapp.com/ingest',
  service: 'web-app',
  authToken: 'your-secret-token',   // optional
  minLevel: 'info',                 // filter out debug in prod
})

logger.info('User signed in', { userId: 'abc123' })
logger.warn('Slow query', { duration: 1200 })
logger.error('Payment failed', { code: 'CARD_DECLINED', amount: 500 })
```

### Node / Bun usage

```ts
import { createLogger } from 'goatlogger/node'

const logger = createLogger({
  endpoint: 'https://logs.yourapp.com/ingest',
  service: 'api-server',
  authToken: process.env.GOATLOGGER_TOKEN,
  batchSize: 50,
  flushInterval: 1000,
})

logger.debug('DB query', { sql: 'SELECT ...', ms: 12 })
logger.info('Request handled', { path: '/api/orders', status: 200 })
logger.fatal('Uncaught exception', { stack: '...' })
```

### Local-only usage (no remote server)

Omit `endpoint` entirely and GoatLogger runs in local-only mode: logs are written to the
console only — no batching, retries, dead-letter queue, or network activity at all.

```ts
import { createLogger } from 'goatlogger/node'

const logger = createLogger({ service: 'cli-tool' })

logger.info('Doing local-only stuff', { pid: process.pid })
```

### Hono / Next.js middleware example

```ts
// middleware.ts
import { createLogger } from 'goatlogger/node'

export const log = createLogger({
  endpoint: process.env.LOG_ENDPOINT!,
  service: 'my-hono-api',
  authToken: process.env.LOG_TOKEN,
})

// In your route:
app.get('/orders', (c) => {
  log.info('Fetching orders', { userId: c.get('userId') })
  // ...
})
```

---

## Transport Modes

GoatLogger supports three transport strategies:

```ts
createLogger({
  endpoint:   'https://logs.yourapp.com/ingest',  // HTTP endpoint (always required as fallback)
  wsEndpoint: 'wss://logs.yourapp.com/ws',         // WebSocket endpoint (optional)
  transport:  'auto',                              // 'http' | 'ws' | 'auto'
})
```

| Mode | Behaviour |
|------|-----------|
| `'http'` | Always HTTP. `wsEndpoint` is ignored. Default when `wsEndpoint` is omitted. |
| `'ws'` | Always WebSocket. Throws if `wsEndpoint` is missing. Retries on disconnect. |
| `'auto'` | Prefers WebSocket when connected; transparently falls back to HTTP when the socket is down. Best for long-lived processes and browser SPAs. |

### WebSocket protocol

The WS transport uses a simple JSON frame protocol:

**Client → Server**
```jsonc
{ "type": "auth",  "token": "your-secret" }           // sent on connect if authToken set
{ "type": "batch", "batchId": "b-xxx", "payload": {…} } // log batch
{ "type": "ping" }                                      // heartbeat every 30s
```

**Server → Client**
```jsonc
{ "type": "ack",   "batchId": "b-xxx" }  // confirms batch received + queued
{ "type": "pong" }                        // heartbeat response
{ "type": "error", "message": "…" }      // validation or auth failure
```

`send()` resolves when the ACK is received. If the ACK doesn't arrive within `ackTimeout` (5s default), the send rejects and the batch goes to the retry/dead-letter flow — same as HTTP.

### Node WebSocket compatibility

| Runtime | WebSocket support |
|---------|-------------------|
| Bun (any) | ✅ native |
| Node 22+ | ✅ native (`globalThis.WebSocket`) |
| Node <22 | Install `ws` package — goatlogger detects and uses it automatically |

```bash
# Only needed for Node <22
npm install ws
```

---

## Config Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `endpoint` | `string` | — | HTTP ingest URL. Omit entirely for local-only mode (console output only, no network) |
| `wsEndpoint` | `string` | — | WebSocket ingest URL |
| `transport` | `'http'\|'ws'\|'auto'` | `'http'` | Transport strategy |
| `service` | `string` | required | Service name tag |
| `authToken` | `string` | — | HTTP: `Authorization: Bearer`; WS: auth frame |
| `minLevel` | `LogLevel` | `'debug'` | Filter logs below this level |
| `batchSize` | `number` | `20` | Flush when queue reaches this size |
| `flushInterval` | `number` | `500` | Max ms between flushes |
| `maxRetries` | `number` | `5` | Retry attempts on network failure |
| `retryDelay` | `number` | `1000` | Base delay (ms), doubles each retry |
| `headers` | `object` | — | Extra headers merged into HTTP requests |
| `silent` | `boolean` | `false` | Suppress console output |
| `onDropped` | `function` | — | Called when entries exceed max retries |

---

## Server Setup

### Requirements

- Bun >= 1.0
- PostgreSQL
- Redis

### Install & run

```bash
cd server
bun install
cp .env.example .env   # fill in DATABASE_URL, REDIS_URL, etc.
bun run db:migrate
bun run dev
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/ingest` | Accept a log batch (returns 202 immediately) |
| `GET` | `/health` | Health check |

### Ingest payload

```json
{
  "entries": [
    {
      "id": "unique-client-id",
      "level": "info",
      "message": "User signed in",
      "data": { "userId": "abc123" },
      "timestamp": "2024-01-01T12:00:00.000Z",
      "service": "web-app",
      "sessionId": "session-id",
      "platform": "browser"
    }
  ],
  "sentAt": "2024-01-01T12:00:00.001Z"
}
```

### Response

```json
{ "accepted": 1, "receivedAt": "2024-01-01T12:00:00.002Z" }
```

`error` and `fatal` level batches get higher queue priority automatically.

---

## Reliability Guarantees

| Failure | Handling |
|---------|---------|
| Brief network blip | Retry w/ exponential backoff (up to 5x) |
| Server down (browser) | Dead-letter → `localStorage` → replayed on next session |
| Server down (node) | Dead-letter → in-memory → replayed on next flush cycle |
| Page close (browser) | `navigator.sendBeacon` last-gasp delivery |
| Process crash (node) | SIGTERM/SIGINT handler flushes queue before exit |
| Duplicate delivery | Server upserts on `clientId` — fully idempotent |
| Server overwhelmed | Redis-backed BullMQ queue absorbs spikes; worker drains async |

---

## Deploying the Server

Fits naturally as a Railway or Fly.io service alongside your existing stack.

### Railway

1. Point Railway at `server/` directory
2. Set env vars: `DATABASE_URL`, `REDIS_URL`, `GOATLOGGER_AUTH_TOKEN`
3. Start command: `bun run start`

### Fly.io (Johannesburg region)

```toml
# fly.toml
app = "goatlogger-server"
primary_region = "jnb"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3210
  force_https = true
```

---

## Project Structure

```
goatlogger/
├── src/                    # SDK source
│   ├── core/
│   │   ├── types.ts        # Shared types & interfaces
│   │   ├── queue.ts        # Batching queue
│   │   ├── retry.ts        # Exponential backoff
│   │   └── logger.ts       # Core GoatLogger class
│   ├── transport/
│   │   ├── http.ts         # Fetch-based HTTP transport
│   │   ├── websocket.ts    # WS transport (ACK protocol, heartbeat, reconnect)
│   │   ├── auto.ts         # Auto transport (prefers WS, falls back to HTTP)
│   │   └── beacon.ts       # Browser Beacon API fallback on page unload
│   ├── persistence/
│   │   ├── memory.ts       # Node dead-letter queue
│   │   └── storage.ts      # Browser localStorage dead-letter queue
│   └── platforms/
│       ├── browser.ts      # Browser entry (beacon + unload hooks)
│       └── node.ts         # Node/Bun entry (process exit hooks, ws compat)
├── server/                 # Ingest server
│   └── src/
│       ├── db/             # Drizzle schema + client + migrations
│       ├── queues/         # BullMQ queue definition
│       ├── routes/
│       │   ├── ingest.ts   # POST /ingest HTTP route
│       │   └── ws.ts       # WS /ws handler (auth, ping/pong, ACK)
│       ├── workers/        # Log enrichment + Postgres writer
│       └── index.ts        # Bun server — HTTP (Hono) + WS side by side
├── package.json
└── tsup.config.ts
```


Usage
```
// Long-running Node service — prefers WS, falls back to HTTP automatically
const logger = createLogger({
  endpoint:   'https://logs.wanko.co.za/ingest',
  wsEndpoint: 'wss://logs.wanko.co.za/ws',
  transport:  'auto',
  service:    'wanko-api',
  authToken:  process.env.LOG_TOKEN,
})

// Browser SPA — same API, same config
const logger = createLogger({
  endpoint:   'https://logs.wanko.co.za/ingest',
  wsEndpoint: 'wss://logs.wanko.co.za/ws',
  transport:  'auto',   // WS while tab is open, HTTP on unload
  service:    'wanko-web',
})
```
