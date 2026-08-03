export interface RetryOptions {
  /** Total number of attempts (not additional retries on top of a first try) */
  maxRetries: number;
  /** Base delay in ms; doubles per attempt */
  baseDelay: number;
  onRetry?: (attempt: number, error: Error) => void;
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
      const error = err instanceof Error ? err : new Error(String(err));
      lastErr = error;
      if (attempt === attempts) break;
      opts.onRetry?.(attempt, error);
      await sleep(opts.baseDelay * 2 ** attempt + Math.random() * 200);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
