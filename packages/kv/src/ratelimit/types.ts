import type { Redis } from "ioredis";

/**
 * Duration unit types
 */
type Unit = "ms" | "s" | "m" | "h" | "d";

/**
 * Duration string format matching @upstash/ratelimit
 * Examples: "10 s", "1 m", "24 h", "7 d", "10s", "1m"
 */
export type Duration = `${number} ${Unit}` | `${number}${Unit}`;

/**
 * Response returned by the rate limiter's limit() method
 * Matches @upstash/ratelimit RatelimitResponse
 */
export interface RatelimitResponse {
  /** Whether the request should be allowed */
  success: boolean;
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Remaining requests in the current window */
  remaining: number;
  /** Unix timestamp (ms) when the rate limit resets */
  reset: number;
  /** Promise that resolves when all pending operations complete */
  pending: Promise<unknown>;
}

/**
 * Algorithm implementation interface
 */
export interface Algorithm {
  /**
   * Check rate limit and consume a token
   */
  limit: (
    ctx: RatelimitContext,
    key: string,
    rate?: number
  ) => Promise<RatelimitResponse>;

  /**
   * Get remaining tokens without consuming
   */
  getRemaining: (
    ctx: RatelimitContext,
    key: string
  ) => Promise<{ remaining: number; reset: number; limit: number }>;

  /**
   * Reset the rate limit for a key
   */
  resetTokens: (ctx: RatelimitContext, key: string) => Promise<void>;

  /**
   * Give back one token a successful `limit()` consumed. Sliding window only;
   * the others leave the token spent.
   */
  refund?: (ctx: RatelimitContext, key: string) => Promise<void>;
}

/**
 * Configuration for creating a Ratelimit instance
 * Matches @upstash/ratelimit RatelimitConfig
 */
export interface RatelimitConfig {
  /** ioredis client instance */
  redis: Redis;
  /** Algorithm factory returned by static methods */
  limiter: () => Algorithm;
  /** Key prefix for Redis keys (default: "@upstash/ratelimit") */
  prefix?: string;
  /** Enable ephemeral in-memory cache for blocked identifiers */
  ephemeralCache?: boolean | Map<string, number>;
  /** Timeout for Redis operations in ms (default: 5000) */
  timeout?: number;
  /** Enable analytics (currently a no-op for compatibility) */
  analytics?: boolean;
}

/**
 * Options for the limit() method
 */
export interface LimitOptions {
  /** Custom rate limit for this specific request */
  rate?: number;
}

/**
 * Internal context passed to algorithm implementations
 */
export interface RatelimitContext {
  redis: Redis;
  prefix: string;
  cache?: EphemeralCache;
}

/**
 * Ephemeral cache interface for in-memory blocking
 */
export interface EphemeralCache {
  isBlocked: (key: string) => { blocked: boolean; reset: number };
  blockUntil: (key: string, reset: number) => void;
  set: (key: string, value: number) => void;
  get: (key: string) => number | undefined;
  incr: (key: string) => number;
}
