/**
 * NetSuite governance is a CONCURRENCY limit, not a request-rate limit: an
 * account is allotted N simultaneous requests per integration (5 on most
 * tiers), and the N+1st is rejected outright with 429 rather than queued. So
 * the correct client shape is a semaphore sized under the allotment plus
 * backoff for the case the allotment is shared with the customer's other
 * integrations — a token-bucket rate limiter would be the wrong tool and would
 * still 429.
 */
export class Semaphore {
  private available: number;
  private readonly waiting: (() => void)[] = [];

  constructor(permits: number) {
    this.available = Math.max(1, permits);
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
      return;
    }
    this.available += 1;
  }
}

/**
 * Full jitter exponential backoff. Deterministic when `random` is injected,
 * which is how the retry loop is unit-tested without real sleeping.
 */
export function backoffDelay(
  attempt: number,
  options: { baseMs?: number; maxMs?: number; random?: () => number } = {}
): number {
  const base = options.baseMs ?? 500;
  const max = options.maxMs ?? 30_000;
  const random = options.random ?? Math.random;
  const ceiling = Math.min(max, base * 2 ** attempt);
  return Math.floor(random() * ceiling);
}
