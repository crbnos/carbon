import type { Redis } from "ioredis";
import { Cache } from "./cache";
import { ms } from "./duration";
import {
  fixedWindowRemainingScript,
  fixedWindowScript,
  slidingWindowRemainingScript,
  slidingWindowScript,
  tokenBucketRemainingScript,
  tokenBucketScript
} from "./scripts";
import type {
  Algorithm,
  Duration,
  EphemeralCache,
  LimitOptions,
  RatelimitConfig,
  RatelimitContext,
  RatelimitResponse
} from "./types";

const DEFAULT_PREFIX = "@carbon/ratelimit";

/**
 * Rate limiter implementation compatible with @upstash/ratelimit API
 * Uses ioredis instead of Upstash REST client
 */
export class Ratelimit {
  private readonly redis: Redis;
  private readonly limiter: () => Algorithm;
  private readonly prefix: string;
  private readonly timeout: number;
  private readonly ctx: RatelimitContext;

  constructor(config: RatelimitConfig) {
    this.redis = config.redis;
    this.limiter = config.limiter;
    this.prefix = config.prefix ?? DEFAULT_PREFIX;
    this.timeout = config.timeout ?? 5000;

    let cache: EphemeralCache | undefined;
    if (config.ephemeralCache === true) {
      cache = new Cache(new Map());
    } else if (config.ephemeralCache instanceof Map) {
      cache = new Cache(config.ephemeralCache);
    }

    this.ctx = {
      redis: this.redis,
      prefix: this.prefix,
      cache
    };
  }

  /**
   * Check rate limit for an identifier
   * @param identifier - Unique identifier (e.g., user ID, IP address)
   * @param opts - Optional limit options
   */
  async limit(
    identifier: string,
    opts?: LimitOptions
  ): Promise<RatelimitResponse> {
    const key = this.getKey(identifier);

    // Check ephemeral cache first (use key for consistency with blockUntil)
    if (this.ctx.cache) {
      const { blocked, reset } = this.ctx.cache.isBlocked(key);
      if (blocked) {
        return {
          success: false,
          limit: 0,
          remaining: 0,
          reset,
          pending: Promise.resolve()
        };
      }
    }

    // Fail open on any Redis error — a cache outage must not block auth.
    try {
      const response = this.limiter().limit(this.ctx, key, opts?.rate);

      if (this.timeout > 0) {
        const timeoutPromise = new Promise<RatelimitResponse>((resolve) => {
          setTimeout(() => {
            resolve(this.failOpen());
          }, this.timeout);
        });

        return await Promise.race([response, timeoutPromise]);
      }

      return await response;
    } catch {
      return this.failOpen();
    }
  }

  private failOpen(): RatelimitResponse {
    return {
      success: true,
      limit: 0,
      remaining: 0,
      reset: 0,
      pending: Promise.resolve()
    };
  }

  /**
   * Block until the rate limit allows the request or timeout is reached
   * @param identifier - Unique identifier
   * @param timeout - Maximum time to wait in ms
   */
  async blockUntilReady(
    identifier: string,
    timeout: number
  ): Promise<RatelimitResponse> {
    if (timeout <= 0) {
      throw new Error("timeout must be positive");
    }

    const deadline = Date.now() + timeout;
    let res: RatelimitResponse;

    while (true) {
      res = await this.limit(identifier);

      if (res.success) {
        return res;
      }

      if (res.reset === 0) {
        throw new Error("Unexpected reset value of 0");
      }

      // Wait until the window resets (or the deadline), then retry. A window
      // boundary already having passed (wait <= 0) is a reason to retry
      // immediately, not to give up — only the deadline ends the loop. The
      // previous `wait <= 0` early-return made this flaky under real timers:
      // for the sliding window `reset` is the end of the current window, so if
      // time crossed that boundary between `limit()` and here, `wait` went
      // negative and we bailed with `success: false` after a single attempt.
      const wait = Math.min(res.reset, deadline) - Date.now();
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
      }

      if (Date.now() >= deadline) {
        return res;
      }
    }
  }

  /**
   * Get remaining tokens for an identifier without consuming
   * @param identifier - Unique identifier
   */
  async getRemaining(
    identifier: string
  ): Promise<{ remaining: number; reset: number; limit: number }> {
    const key = this.getKey(identifier);
    try {
      return await this.limiter().getRemaining(this.ctx, key);
    } catch {
      // Redis down: report no known usage rather than throwing.
      return { remaining: 0, reset: 0, limit: 0 };
    }
  }

  /**
   * Reset the rate limit for an identifier
   * @param identifier - Unique identifier
   */
  async resetUsedTokens(identifier: string): Promise<void> {
    const key = this.getKey(identifier);
    try {
      return await this.limiter().resetTokens(this.ctx, key);
    } catch {
      // Redis down: nothing to reset, don't throw.
    }
  }

  private getKey(identifier: string): string {
    return `${this.prefix}:${identifier}`;
  }

  // ===== Static Algorithm Factory Methods =====

  /**
   * Fixed Window Rate Limiting
   *
   * Each request inside a fixed time window increases a counter.
   * Once the counter reaches the maximum, all further requests are rejected.
   *
   * Pros: Simple, low memory usage
   * Cons: Can allow bursts at window boundaries
   *
   * @param tokens - Maximum requests per window
   * @param window - Window duration (e.g., "10 s", "1 m", "1 h")
   */
  static fixedWindow(tokens: number, window: Duration): () => Algorithm {
    const windowMs = ms(window);

    return () => ({
      async limit(ctx, key, rate?): Promise<RatelimitResponse> {
        const limit = rate ?? tokens;
        const now = Date.now();

        const result = (await ctx.redis.eval(
          fixedWindowScript,
          1,
          key,
          limit,
          windowMs,
          1
        )) as [number, number];

        const [current, effectiveLimit] = result;
        const remaining = Math.max(0, effectiveLimit - current);
        const reset = now + windowMs - (now % windowMs) + windowMs;
        const success = current <= effectiveLimit;

        // Update ephemeral cache if blocked
        if (!success && ctx.cache) {
          ctx.cache.blockUntil(key, reset);
        }

        return {
          success,
          limit: effectiveLimit,
          remaining,
          reset,
          pending: Promise.resolve()
        };
      },

      async getRemaining(ctx, key) {
        const result = (await ctx.redis.eval(
          fixedWindowRemainingScript,
          1,
          key,
          tokens
        )) as [number, number];

        const [remaining, limit] = result;
        const now = Date.now();
        const reset = now + windowMs - (now % windowMs) + windowMs;

        return { remaining: Math.max(0, remaining), reset, limit };
      },

      async resetTokens(ctx, key) {
        await ctx.redis.del(key);
      }
    });
  }

  /**
   * Sliding Window Rate Limiting
   *
   * Combines two fixed windows with a weighted score for smoother rate limiting.
   * Prevents the boundary burst problem of fixed windows.
   *
   * Pros: Better boundary behavior, more accurate rate limiting
   * Cons: Slightly higher memory (2 keys per identifier)
   *
   * @param tokens - Maximum requests per window
   * @param window - Window duration (e.g., "10 s", "1 m", "1 h")
   */
  static slidingWindow(tokens: number, window: Duration): () => Algorithm {
    const windowMs = ms(window);

    return () => ({
      async limit(ctx, key, rate?): Promise<RatelimitResponse> {
        const limit = rate ?? tokens;
        const now = Date.now();
        const currentWindow = Math.floor(now / windowMs);
        const currentKey = `${key}:${currentWindow}`;
        const previousKey = `${key}:${currentWindow - 1}`;

        const result = (await ctx.redis.eval(
          slidingWindowScript,
          2,
          currentKey,
          previousKey,
          limit,
          now,
          windowMs,
          1
        )) as [number, number];

        const [remaining, effectiveLimit] = result;
        const success = remaining >= 0;
        const reset = (currentWindow + 1) * windowMs;

        // Update ephemeral cache if blocked
        if (!success && ctx.cache) {
          ctx.cache.blockUntil(key, reset);
        }

        return {
          success,
          limit: effectiveLimit,
          remaining: Math.max(0, remaining),
          reset,
          pending: Promise.resolve()
        };
      },

      async getRemaining(ctx, key) {
        const now = Date.now();
        const currentWindow = Math.floor(now / windowMs);
        const currentKey = `${key}:${currentWindow}`;
        const previousKey = `${key}:${currentWindow - 1}`;

        const result = (await ctx.redis.eval(
          slidingWindowRemainingScript,
          2,
          currentKey,
          previousKey,
          tokens,
          now,
          windowMs
        )) as [number, number];

        const [remaining, limit] = result;
        const reset = (currentWindow + 1) * windowMs;

        return { remaining: Math.max(0, remaining), reset, limit };
      },

      async resetTokens(ctx, key) {
        const now = Date.now();
        const currentWindow = Math.floor(now / windowMs);
        const currentKey = `${key}:${currentWindow}`;
        const previousKey = `${key}:${currentWindow - 1}`;
        await ctx.redis.del(currentKey, previousKey);
      }
    });
  }

  /**
   * Token Bucket Rate Limiting
   *
   * A bucket filled with tokens that refills at a constant rate.
   * Allows bursts up to the bucket size while maintaining an average rate.
   *
   * Pros: Allows controlled bursts, smooth rate limiting
   * Cons: Slightly more complex, requires hash storage
   *
   * @param refillRate - Tokens added per interval
   * @param interval - Refill interval duration (e.g., "1 s", "10 s")
   * @param maxTokens - Maximum tokens in bucket (burst capacity)
   */
  static tokenBucket(
    refillRate: number,
    interval: Duration,
    maxTokens?: number
  ): () => Algorithm {
    const intervalMs = ms(interval);
    const bucketSize = maxTokens ?? refillRate;

    return () => ({
      async limit(ctx, key, rate?): Promise<RatelimitResponse> {
        const limit = rate ?? bucketSize;
        const now = Date.now();

        const result = (await ctx.redis.eval(
          tokenBucketScript,
          1,
          key,
          limit,
          intervalMs,
          refillRate,
          now,
          1
        )) as [number, number, number];

        const [remaining, reset, effectiveLimit] = result;
        const success = remaining >= 0;

        // Update ephemeral cache if blocked
        if (!success && ctx.cache) {
          ctx.cache.blockUntil(key, reset);
        }

        return {
          success,
          limit: effectiveLimit,
          remaining: Math.max(0, remaining),
          reset,
          pending: Promise.resolve()
        };
      },

      async getRemaining(ctx, key) {
        const now = Date.now();

        const result = (await ctx.redis.eval(
          tokenBucketRemainingScript,
          1,
          key,
          bucketSize,
          intervalMs,
          refillRate,
          now
        )) as [number, number, number];

        const [remaining, reset, limit] = result;

        return { remaining: Math.max(0, remaining), reset, limit };
      },

      async resetTokens(ctx, key) {
        await ctx.redis.del(key);
      }
    });
  }
}
