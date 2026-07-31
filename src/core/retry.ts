export interface RetryOptions {
  /** Total number of attempts (not additional retries on top of a first try) */
  maxRetries: number;
  /** Base delay in ms before the second attempt; doubles each subsequent attempt */
  retryDelay: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const attempts = Math.max(1, opts.maxRetries);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts) break;
      await sleep(opts.retryDelay * 2 ** (attempt - 1));
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
