// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { EphemeralCache } from "./types";

/**
 * In-memory cache for blocking identifiers that have exceeded their rate limit.
 * This prevents unnecessary Redis calls for already-blocked identifiers.
 */
export class Cache implements EphemeralCache {
  private readonly cache: Map<string, number>;

  constructor(cache?: Map<string, number>) {
    this.cache = cache ?? new Map();
  }

  /**
   * Check if an identifier is blocked
   */
  isBlocked(key: string): { blocked: boolean; reset: number } {
    const reset = this.cache.get(key);
    if (!reset) {
      return { blocked: false, reset: 0 };
    }

    if (Date.now() >= reset) {
      this.cache.delete(key);
      return { blocked: false, reset: 0 };
    }

    return { blocked: true, reset };
  }

  /**
   * Block an identifier until a specific timestamp
   */
  blockUntil(key: string, reset: number): void {
    this.cache.set(key, reset);
  }

  /**
   * Set a value in the cache
   */
  set(key: string, value: number): void {
    this.cache.set(key, value);
  }

  /**
   * Get a value from the cache
   */
  get(key: string): number | undefined {
    return this.cache.get(key);
  }

  /**
   * Increment a value in the cache
   */
  incr(key: string): number {
    const current = this.cache.get(key) ?? 0;
    const next = current + 1;
    this.cache.set(key, next);
    return next;
  }
}
