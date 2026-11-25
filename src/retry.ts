// Retry with exponential backoff for transient API failures (HTTP 429 and 5xx).

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  // Network-level failures (DNS, reset connections) surface as TypeError from fetch.
  return err instanceof TypeError;
}

export interface RetryOptions {
  retries?: number; // extra attempts after the first one
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, err: unknown) => void;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseDelayMs = 500, sleep = defaultSleep, onRetry } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      attempt++;
      onRetry?.(attempt, err);
      // 500ms, 1s, 2s ... plus up to 100ms jitter
      await sleep(baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 100));
    }
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
