/**
 * Runs `fn` with every `setTimeout` delay collapsed to 0ms, so code under test that
 * schedules real backoff/heartbeat/reconnect timers resolves near-instantly instead of
 * making the suite wait out real-world delays. `clearTimeout`/`unref` still operate on
 * genuine timer handles since we only intercept the delay argument.
 */
export async function withImmediateTimers<T>(fn: () => Promise<T> | T): Promise<T> {
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: (...args: unknown[]) => void, _ms?: number, ...args: unknown[]) =>
    realSetTimeout(handler, 0, ...args)) as typeof setTimeout;

  try {
    return await fn();
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}
