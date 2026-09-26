import type { Redis } from "ioredis";
import RedisMock from "ioredis-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Ratelimit } from "./ratelimit";

// Create a mock Redis client
const createMockRedis = () => {
  const storage = new Map<string, any>();
  const hashStorage = new Map<string, Map<string, any>>();

  return {
    eval: vi.fn(),
    del: vi.fn().mockImplementation((...keys: string[]) => {
      keys.forEach((key) => {
        storage.delete(key);
        hashStorage.delete(key);
      });
      return Promise.resolve(keys.length);
    }),
    get: vi.fn().mockImplementation((key: string) => {
      return Promise.resolve(storage.get(key) ?? null);
    }),
    set: vi.fn().mockImplementation((key: string, value: any) => {
      storage.set(key, value);
      return Promise.resolve("OK");
    }),
    // Helper to access internal storage for testing
    _storage: storage,
    _hashStorage: hashStorage
  } as unknown as Redis & {
    _storage: Map<string, any>;
    _hashStorage: Map<string, Map<string, any>>;
  };
};

describe("Ratelimit", () => {
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create a ratelimiter with default options", () => {
      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.slidingWindow(10, "1 h")
      });

      expect(ratelimit).toBeInstanceOf(Ratelimit);
    });

    it("should create a ratelimiter with custom prefix", () => {
      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.slidingWindow(10, "1 h"),
        prefix: "custom-prefix"
      });

      expect(ratelimit).toBeInstanceOf(Ratelimit);
    });

    it("should create a ratelimiter with ephemeral cache enabled", () => {
      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.slidingWindow(10, "1 h"),
        ephemeralCache: true
      });

      expect(ratelimit).toBeInstanceOf(Ratelimit);
    });

    it("should create a ratelimiter with custom cache map", () => {
      const customCache = new Map<string, number>();
      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.slidingWindow(10, "1 h"),
        ephemeralCache: customCache
      });

      expect(ratelimit).toBeInstanceOf(Ratelimit);
    });
  });

  describe("fixedWindow algorithm", () => {
    it("should allow requests within limit", async () => {
      // Mock Redis eval to return [1, 10] (1 request used, limit of 10)
      mockRedis.eval = vi.fn().mockResolvedValue([1, 10]);

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.fixedWindow(10, "1 m")
      });

      const result = await ratelimit.limit("user:123");

      expect(result.success).toBe(true);
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(9);
      expect(result.reset).toBeGreaterThan(Date.now());
    });

    it("should block requests when limit exceeded", async () => {
      // Mock Redis eval to return [11, 10] (11 requests used, limit of 10)
      mockRedis.eval = vi.fn().mockResolvedValue([11, 10]);

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.fixedWindow(10, "1 m")
      });

      const result = await ratelimit.limit("user:123");

      expect(result.success).toBe(false);
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(0);
    });

    it("should call Redis eval with correct parameters", async () => {
      mockRedis.eval = vi.fn().mockResolvedValue([1, 10]);

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.fixedWindow(10, "1 m"),
        prefix: "test"
      });

      await ratelimit.limit("user:123");

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String), // Lua script
        1, // Number of keys
        "test:user:123", // Key
        10, // Limit
        60000, // Window in ms
        1 // Increment by
      );
    });
  });

  describe("slidingWindow algorithm", () => {
    it("should allow requests within limit", async () => {
      // Mock Redis eval to return [9, 10] (9 remaining, limit of 10)
      mockRedis.eval = vi.fn().mockResolvedValue([9, 10]);

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.slidingWindow(10, "1 h")
      });

      const result = await ratelimit.limit("user:123");

      expect(result.success).toBe(true);
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(9);
    });

    it("should block requests when limit exceeded", async () => {
      // Mock Redis eval to return [-1, 10] (blocked, limit of 10)
      mockRedis.eval = vi.fn().mockResolvedValue([-1, 10]);

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.slidingWindow(10, "1 h")
      });

      const result = await ratelimit.limit("user:123");

      expect(result.success).toBe(false);
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(0);
    });

    it("should call Redis eval with two keys (current and previous window)", async () => {
      mockRedis.eval = vi.fn().mockResolvedValue([9, 10]);

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.slidingWindow(10, "1 h"),
        prefix: "test"
      });

      await ratelimit.limit("user:123");

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String), // Lua script
        2, // Number of keys (current + previous window)
        expect.stringMatching(/^test:user:123:\d+$/), // Current window key
        expect.stringMatching(/^test:user:123:\d+$/), // Previous window key
        10, // Limit
        expect.any(Number), // Current timestamp
        3600000, // Window in ms (1 hour)
        1 // Increment by
      );
    });
  });

  describe("tokenBucket algorithm", () => {
    it("should allow requests when tokens available", async () => {
      // Mock Redis eval to return [9, next_refill_time, 10]
      const nextRefill = Date.now() + 1000;
      mockRedis.eval = vi.fn().mockResolvedValue([9, nextRefill, 10]);

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.tokenBucket(1, "1 s", 10)
      });

      const result = await ratelimit.limit("user:123");

      expect(result.success).toBe(true);
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(9);
      expect(result.reset).toBe(nextRefill);
    });

    it("should block requests when bucket is empty", async () => {
      const nextRefill = Date.now() + 1000;
      mockRedis.eval = vi.fn().mockResolvedValue([-1, nextRefill, 10]);

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.tokenBucket(1, "1 s", 10)
      });

      const result = await ratelimit.limit("user:123");

      expect(result.success).toBe(false);
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(0);
      expect(result.reset).toBe(nextRefill);
    });

    it("should use refillRate as maxTokens when not specified", async () => {
      mockRedis.eval = vi.fn().mockResolvedValue([4, Date.now() + 1000, 5]);

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.tokenBucket(5, "10 s"), // No maxTokens specified
        prefix: "test"
      });

      await ratelimit.limit("user:123");

      // Check that maxTokens (5) was passed to the script
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        "test:user:123",
        5, // maxTokens defaults to refillRate
        10000, // 10 seconds in ms
        5, // refillRate
        expect.any(Number),
        1
      );
    });
  });

  describe("ephemeral cache", () => {
    it("should use cache to block subsequent requests", async () => {
      // First call: blocked (returns [-1, 10] meaning blocked with limit 10)
      mockRedis.eval = vi.fn().mockResolvedValue([-1, 10]);

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.slidingWindow(10, "1 h"),
        ephemeralCache: true
      });

      // First request - blocked by Redis
      const firstResult = await ratelimit.limit("user:123");
      expect(firstResult.success).toBe(false);

      // Clear the mock call history but keep returning blocked result
      vi.clearAllMocks();

      // Second request - should be blocked by cache, not Redis
      // The cache blocks based on the key prefix + identifier
      const result = await ratelimit.limit("user:123");

      expect(result.success).toBe(false);
      // Cache uses the full key including prefix
      expect(mockRedis.eval).not.toHaveBeenCalled(); // Cache should prevent Redis call
    });

    it("should allow requests after cache expires", async () => {
      mockRedis.eval = vi.fn().mockResolvedValue([-1, 10]);

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.slidingWindow(10, "1 h"),
        ephemeralCache: true
      });

      // First request - blocked
      await ratelimit.limit("user:123");

      // Advance time past the window
      vi.advanceTimersByTime(3600001);

      // Mock successful response for next call
      mockRedis.eval = vi.fn().mockResolvedValue([9, 10]);

      // Second request - should go to Redis again
      const result = await ratelimit.limit("user:123");

      expect(mockRedis.eval).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe("timeout handling", () => {
    it("should return success on timeout", async () => {
      // Create a promise that never resolves
      mockRedis.eval = vi.fn().mockImplementation(
        () =>
          new Promise(() => {
            /* intentionally never resolves */
          })
      );

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.slidingWindow(10, "1 h"),
        timeout: 1000
      });

      const resultPromise = ratelimit.limit("user:123");

      // Advance time past timeout
      vi.advanceTimersByTime(1001);

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.limit).toBe(0);
      expect(result.remaining).toBe(0);
      expect(result.reset).toBe(0);
    });
  });

  describe("getRemaining()", () => {
    it("should return remaining tokens for fixedWindow", async () => {
      mockRedis.eval = vi.fn().mockResolvedValue([7, 10]);

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.fixedWindow(10, "1 m")
      });

      const result = await ratelimit.getRemaining("user:123");

      expect(result.remaining).toBe(7);
      expect(result.limit).toBe(10);
      expect(result.reset).toBeGreaterThan(Date.now());
    });

    it("should return remaining tokens for slidingWindow", async () => {
      mockRedis.eval = vi.fn().mockResolvedValue([5, 10]);

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.slidingWindow(10, "1 h")
      });

      const result = await ratelimit.getRemaining("user:123");

      expect(result.remaining).toBe(5);
      expect(result.limit).toBe(10);
    });

    it("should return remaining tokens for tokenBucket", async () => {
      mockRedis.eval = vi.fn().mockResolvedValue([8, Date.now() + 1000, 10]);

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.tokenBucket(1, "1 s", 10)
      });

      const result = await ratelimit.getRemaining("user:123");

      expect(result.remaining).toBe(8);
      expect(result.limit).toBe(10);
    });
  });

  describe("resetUsedTokens()", () => {
    it("should delete the key for fixedWindow", async () => {
      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.fixedWindow(10, "1 m"),
        prefix: "test"
      });

      await ratelimit.resetUsedTokens("user:123");

      expect(mockRedis.del).toHaveBeenCalledWith("test:user:123");
    });

    it("should delete both window keys for slidingWindow", async () => {
      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.slidingWindow(10, "1 h"),
        prefix: "test"
      });

      await ratelimit.resetUsedTokens("user:123");

      expect(mockRedis.del).toHaveBeenCalledWith(
        expect.stringMatching(/^test:user:123:\d+$/),
        expect.stringMatching(/^test:user:123:\d+$/)
      );
    });

    it("should delete the key for tokenBucket", async () => {
      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.tokenBucket(1, "1 s", 10),
        prefix: "test"
      });

      await ratelimit.resetUsedTokens("user:123");

      expect(mockRedis.del).toHaveBeenCalledWith("test:user:123");
    });
  });

  describe("blockUntilReady()", () => {
    it("should return immediately if not rate limited", async () => {
      mockRedis.eval = vi.fn().mockResolvedValue([9, 10]);

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.slidingWindow(10, "1 h")
      });

      const result = await ratelimit.blockUntilReady("user:123", 5000);

      expect(result.success).toBe(true);
    });

    it("should throw error for non-positive timeout", async () => {
      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.slidingWindow(10, "1 h")
      });

      await expect(ratelimit.blockUntilReady("user:123", 0)).rejects.toThrow(
        "timeout must be positive"
      );

      await expect(ratelimit.blockUntilReady("user:123", -1)).rejects.toThrow(
        "timeout must be positive"
      );
    });

    it("should wait and retry when rate limited", async () => {
      // Use real timers for this test since fake timers + async is tricky
      vi.useRealTimers();

      // First call: blocked, second call: allowed
      mockRedis.eval = vi
        .fn()
        .mockResolvedValueOnce([-1, 10]) // First: blocked
        .mockResolvedValueOnce([9, 10]); // Second: allowed

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.slidingWindow(10, "100 ms") // Short window for fast test
      });

      const result = await ratelimit.blockUntilReady("user:123", 500);

      expect(result.success).toBe(true);
      expect(mockRedis.eval).toHaveBeenCalledTimes(2);

      // Restore fake timers for other tests
      vi.useFakeTimers();
    });
  });

  describe("analytics option (compatibility)", () => {
    it("should accept analytics option without error", () => {
      // analytics is a no-op for compatibility
      expect(() => {
        new Ratelimit({
          redis: mockRedis,
          limiter: Ratelimit.slidingWindow(10, "1 h"),
          analytics: true
        });
      }).not.toThrow();
    });
  });

  describe("prefix handling", () => {
    it("should use default prefix when not specified", async () => {
      mockRedis.eval = vi.fn().mockResolvedValue([9, 10]);

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.fixedWindow(10, "1 m")
      });

      await ratelimit.limit("user:123");

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        "@carbon/ratelimit:user:123", // Default prefix
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });

    it("should use custom prefix when specified", async () => {
      mockRedis.eval = vi.fn().mockResolvedValue([9, 10]);

      const ratelimit = new Ratelimit({
        redis: mockRedis,
        limiter: Ratelimit.fixedWindow(10, "1 m"),
        prefix: "myapp:ratelimit"
      });

      await ratelimit.limit("user:123");

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        "myapp:ratelimit:user:123",
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });
  });
});

// These run the REAL Lua scripts (ioredis-mock executes them), so they pin what
// Redis does with the counters rather than what a stubbed `eval` returns.
describe("refund() against the real window scripts", () => {
  beforeEach(async () => {
    // Only the clock is faked — mid-window, so no test straddles a boundary.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-01-01T00:30:00.000Z"));
    // ioredis-mock instances share one keyspace; start every test empty.
    await new RedisMock().flushall();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const create = () =>
    new Ratelimit({
      redis: new RedisMock() as unknown as Redis,
      limiter: Ratelimit.slidingWindow(2, "1 h"),
      timeout: 0
    });

  it("a concurrent burst consumes at most the budget", async () => {
    const ratelimit = create();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => ratelimit.limit("terminal"))
    );
    expect(results.filter((r) => r.success)).toHaveLength(2);
  });

  it("returns a consumed token so the next call passes", async () => {
    const ratelimit = create();
    expect((await ratelimit.limit("terminal")).success).toBe(true);
    expect((await ratelimit.limit("terminal")).success).toBe(true);
    expect((await ratelimit.limit("terminal")).success).toBe(false);

    await ratelimit.refund("terminal");

    expect((await ratelimit.limit("terminal")).success).toBe(true);
    expect((await ratelimit.limit("terminal")).success).toBe(false);
  });

  it("never banks credit below zero", async () => {
    const ratelimit = create();
    await ratelimit.refund("terminal");
    await ratelimit.refund("terminal");

    expect((await ratelimit.limit("terminal")).success).toBe(true);
    expect((await ratelimit.limit("terminal")).success).toBe(true);
    expect((await ratelimit.limit("terminal")).success).toBe(false);
  });

  it("only returns the identifier's own token", async () => {
    const ratelimit = create();
    await ratelimit.limit("a");
    await ratelimit.limit("a");
    await ratelimit.limit("b");

    await ratelimit.refund("b");

    expect((await ratelimit.limit("a")).success).toBe(false);
  });
});
