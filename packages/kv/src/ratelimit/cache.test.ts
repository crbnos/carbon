// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "./cache";

describe("Cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("should create cache with empty map by default", () => {
      const cache = new Cache();
      expect(cache.get("key")).toBeUndefined();
    });

    it("should create cache with provided map", () => {
      const existingMap = new Map<string, number>();
      existingMap.set("existing", 123);
      const cache = new Cache(existingMap);
      expect(cache.get("existing")).toBe(123);
    });
  });

  describe("isBlocked()", () => {
    it("should return not blocked for unknown key", () => {
      const cache = new Cache();
      const result = cache.isBlocked("unknown");
      expect(result.blocked).toBe(false);
      expect(result.reset).toBe(0);
    });

    it("should return blocked when reset time is in the future", () => {
      const cache = new Cache();
      const futureTime = Date.now() + 10000; // 10 seconds in future
      cache.blockUntil("user:123", futureTime);

      const result = cache.isBlocked("user:123");
      expect(result.blocked).toBe(true);
      expect(result.reset).toBe(futureTime);
    });

    it("should return not blocked when reset time has passed", () => {
      const cache = new Cache();
      const pastTime = Date.now() + 5000;
      cache.blockUntil("user:123", pastTime);

      // Advance time past the reset
      vi.advanceTimersByTime(6000);

      const result = cache.isBlocked("user:123");
      expect(result.blocked).toBe(false);
      expect(result.reset).toBe(0);
    });

    it("should clean up expired entries on check", () => {
      const cache = new Cache();
      const resetTime = Date.now() + 5000;
      cache.blockUntil("user:123", resetTime);

      // Advance time past the reset
      vi.advanceTimersByTime(6000);

      // First check should clean up
      cache.isBlocked("user:123");

      // Key should now be gone
      expect(cache.get("user:123")).toBeUndefined();
    });
  });

  describe("blockUntil()", () => {
    it("should block a key until specified time", () => {
      const cache = new Cache();
      const resetTime = Date.now() + 10000;
      cache.blockUntil("user:123", resetTime);

      expect(cache.get("user:123")).toBe(resetTime);
    });

    it("should overwrite existing block time", () => {
      const cache = new Cache();
      const firstReset = Date.now() + 5000;
      const secondReset = Date.now() + 10000;

      cache.blockUntil("user:123", firstReset);
      cache.blockUntil("user:123", secondReset);

      expect(cache.get("user:123")).toBe(secondReset);
    });
  });

  describe("set() and get()", () => {
    it("should set and get values", () => {
      const cache = new Cache();
      cache.set("key1", 100);
      cache.set("key2", 200);

      expect(cache.get("key1")).toBe(100);
      expect(cache.get("key2")).toBe(200);
    });

    it("should return undefined for non-existent keys", () => {
      const cache = new Cache();
      expect(cache.get("nonexistent")).toBeUndefined();
    });

    it("should overwrite existing values", () => {
      const cache = new Cache();
      cache.set("key", 100);
      cache.set("key", 200);
      expect(cache.get("key")).toBe(200);
    });
  });

  describe("incr()", () => {
    it("should increment from 0 for new keys", () => {
      const cache = new Cache();
      const result = cache.incr("counter");
      expect(result).toBe(1);
      expect(cache.get("counter")).toBe(1);
    });

    it("should increment existing values", () => {
      const cache = new Cache();
      cache.set("counter", 5);

      expect(cache.incr("counter")).toBe(6);
      expect(cache.incr("counter")).toBe(7);
      expect(cache.incr("counter")).toBe(8);
    });

    it("should handle multiple counters independently", () => {
      const cache = new Cache();

      cache.incr("counter1");
      cache.incr("counter1");
      cache.incr("counter2");

      expect(cache.get("counter1")).toBe(2);
      expect(cache.get("counter2")).toBe(1);
    });
  });
});
