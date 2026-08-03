import { describe, expect, test } from "bun:test";
import { withRetry } from "./retry";
import { withImmediateTimers } from "../test-support/fake-timers";

describe("withRetry", () => {
  test("resolves with the function's result on first success, without retrying", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        return "ok";
      },
      { maxRetries: 5, baseDelay: 1 }
    );

    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  test("retries on failure and resolves once the function eventually succeeds", async () => {
    let calls = 0;
    const onRetry = (attempt: number, _error: Error) => attempts.push(attempt);
    const attempts: number[] = [];

    const result = await withImmediateTimers(() =>
      withRetry(
        async () => {
          calls++;
          if (calls < 3) throw new Error(`fail ${calls}`);
          return "recovered";
        },
        { maxRetries: 5, baseDelay: 1, onRetry }
      )
    );

    expect(result).toBe("recovered");
    expect(calls).toBe(3);
    expect(attempts).toEqual([1, 2]);
  });

  test("throws the last error once maxRetries is exhausted, without a final onRetry call", async () => {
    let calls = 0;
    const attempts: number[] = [];

    const promise = withImmediateTimers(() =>
      withRetry(
        async () => {
          calls++;
          throw new Error(`boom ${calls}`);
        },
        { maxRetries: 3, baseDelay: 1, onRetry: (attempt) => attempts.push(attempt) }
      )
    );

    await expect(promise).rejects.toThrow("boom 3");
    expect(calls).toBe(3);
    // onRetry fires between attempts, never after the final (failing) attempt.
    expect(attempts).toEqual([1, 2]);
  });

  test("wraps non-Error throws in an Error", async () => {
    const promise = withRetry(
      async () => {
        throw "just a string";
      },
      { maxRetries: 1, baseDelay: 1 }
    );

    await expect(promise).rejects.toThrow("just a string");
  });

  test("clamps maxRetries below 1 to a single attempt", async () => {
    let calls = 0;
    const promise = withRetry(
      async () => {
        calls++;
        throw new Error("always fails");
      },
      { maxRetries: 0, baseDelay: 1 }
    );

    await expect(promise).rejects.toThrow("always fails");
    expect(calls).toBe(1);
  });
});
