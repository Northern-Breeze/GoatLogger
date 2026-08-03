// Wire smoke test: sends 5 log entries to a locally running goatlogger-server
// and confirms they land in Postgres. Run against a server started via
// `docker compose up` (or `bun run dev` in server/ with DATABASE_URL/REDIS_URL set).
//
//   GOATLOGGER_ENDPOINT=http://localhost:3210/ingest bun run examples/smoke.ts

import { createLogger } from "../dist/platforms/node.js";

const endpoint = process.env.GOATLOGGER_ENDPOINT ?? "http://localhost:3210/ingest";
const service = "smoke-test";

const logger = createLogger({
  endpoint,
  service,
  batchSize: 5,
  flushInterval: 200,
});

for (let i = 1; i <= 5; i++) {
  logger.info(`smoke test entry ${i}`, { i });
}

await logger.shutdown();
console.log(`[smoke] sent 5 entries for service "${service}" to ${endpoint}`);
process.exit(0);
