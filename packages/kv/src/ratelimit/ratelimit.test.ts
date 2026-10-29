// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Redis } from "ioredis";
import RedisMock from "ioredis-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Ratelimit } from "./ratelimit";
import type { RatelimitConfig } from "./types";

// These run the REAL Lua scripts (ioredis-mock executes them), so they pin what
// Redis does with the counters, not what a stubbed `eval` returns. The token
// bucket is not here: ioredis-mock returns a missing HMGET field as userdata,
// not Redis's `false`, so its script cannot run on the mock.

const MIDNIGHT = 1_704_067_200_000; // 2024-01-01T00:00:00Z
const minutes = (n: number) => MIDNIGHT + n * 60_000;

let redis: Redis;

function base(overrides: Partial<RatelimitConfig> = {}) {
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(2, "1 h"),
    timeout: 0,
    ...overrides
  });
}

async function outcomes(ratelimit: Ratelimit, calls: number, id = "user") {
  const results = [];
  for (let i = 0; i < calls; i++) {
    const { success, remaining } = await ratelimit.limit(id);
    results.push({ success, remaining });
  }
  return results;
}

beforeEach(async () => {
  // Only the clock is faked, mid-window, so no test straddles a boundary.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(minutes(30));
  // ioredis-mock instances share one keyspace; start every test empty.
  redis = new RedisMock() as unknown as Redis;
  await redis.flushall();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fixed window", () => {
  const fixed = () => base({ limiter: Ratelimit.fixedWindow(3, "1 m") });

  it("allows the budget, then blocks", async () => {
    expect(await outcomes(fixed(), 4)).toEqual([
      { success: true, remaining: 2 },
      { success: true, remaining: 1 },
      { success: true, remaining: 0 },
      { success: false, remaining: 0 }
    ]);
  });

  it("allows again once the window has expired", async () => {
    const ratelimit = fixed();
    await outcomes(ratelimit, 3);
    vi.setSystemTime(minutes(31) + 1);
    expect((await ratelimit.limit("user")).success).toBe(true);
  });

  it("takes a per-call rate over the configured one", async () => {
    const ratelimit = fixed();
    expect(await ratelimit.limit("user", { rate: 1 })).toMatchObject({
      success: true,
      limit: 1,
      remaining: 0
    });
    expect((await ratelimit.limit("user", { rate: 1 })).success).toBe(false);
  });
});

describe("sliding window", () => {
  it("allows the budget, then blocks until the window ends", async () => {
    const ratelimit = base();
    expect(await outcomes(ratelimit, 3)).toEqual([
      { success: true, remaining: 1 },
      { success: true, remaining: 0 },
      { success: false, remaining: 0 }
    ]);
    expect((await ratelimit.limit("user")).reset).toBe(minutes(60));
  });

  it("counts the previous window by how much of it still overlaps", async () => {
    // Two calls at 23:45 the day before; at 00:30 half the previous hour still
    // overlaps, so floor(0.5 × 2) = 1 of them counts and one call is left.
    const ratelimit = base();
    vi.setSystemTime(minutes(-15));
    await outcomes(ratelimit, 2);
    vi.setSystemTime(minutes(30));
    expect(await outcomes(ratelimit, 2)).toEqual([
      { success: true, remaining: 0 },
      { success: false, remaining: 0 }
    ]);
  });

  it("a concurrent burst consumes at most the budget", async () => {
    const ratelimit = base();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => ratelimit.limit("user"))
    );
    expect(results.filter((r) => r.success)).toHaveLength(2);
  });
});

describe.each([
  ["fixed window", Ratelimit.fixedWindow(2, "1 m")],
  ["sliding window", Ratelimit.slidingWindow(2, "1 h")]
])("%s", (_name, limiter) => {
  it("reports what is left without using it", async () => {
    const ratelimit = base({ limiter });
    await ratelimit.limit("user");
    expect((await ratelimit.getRemaining("user")).remaining).toBe(1);
    expect((await ratelimit.getRemaining("user")).remaining).toBe(1);
  });

  it("starts over after resetUsedTokens", async () => {
    const ratelimit = base({ limiter });
    await outcomes(ratelimit, 2);
    await ratelimit.resetUsedTokens("user");
    expect((await ratelimit.limit("user")).success).toBe(true);
  });

  it("keeps each identifier's budget, and each prefix's, apart", async () => {
    const ratelimit = base({ limiter });
    await outcomes(ratelimit, 2, "a");
    expect((await ratelimit.limit("b")).success).toBe(true);
    expect((await base({ limiter, prefix: "other" }).limit("a")).success).toBe(
      true
    );
    expect((await base({ limiter }).limit("a")).success).toBe(false);
  });
});

describe("refund", () => {
  it("returns a consumed token so the next call passes", async () => {
    const ratelimit = base();
    await outcomes(ratelimit, 3);
    await ratelimit.refund("user");
    expect(await outcomes(ratelimit, 2)).toEqual([
      { success: true, remaining: 0 },
      { success: false, remaining: 0 }
    ]);
  });

  it("never banks credit below zero", async () => {
    const ratelimit = base();
    await ratelimit.refund("user");
    await ratelimit.refund("user");
    expect((await outcomes(ratelimit, 3)).map((r) => r.success)).toEqual([
      true,
      true,
      false
    ]);
  });

  it("only returns the identifier's own token", async () => {
    const ratelimit = base();
    await outcomes(ratelimit, 2, "a");
    await ratelimit.limit("b");
    await ratelimit.refund("b");
    expect((await ratelimit.limit("a")).success).toBe(false);
  });
});

describe("ephemeral cache", () => {
  it("keeps a blocked identifier blocked in memory until its reset", async () => {
    const ratelimit = base({ ephemeralCache: true });
    await outcomes(ratelimit, 3);
    // Clearing Redis proves the next answer comes from memory.
    await ratelimit.resetUsedTokens("user");
    expect(await ratelimit.limit("user")).toMatchObject({
      success: false,
      reset: minutes(60)
    });

    vi.setSystemTime(minutes(60));
    expect((await ratelimit.limit("user")).success).toBe(true);
  });
});

describe("when Redis fails", () => {
  const failOpen = { success: true, limit: 0, remaining: 0, reset: 0 };

  it("fails open on an error", async () => {
    const down = {
      eval: async () => {
        throw new Error("ECONNREFUSED");
      }
    } as unknown as Redis;
    expect(await base({ redis: down }).limit("user")).toMatchObject(failOpen);
    expect(await base({ redis: down }).getRemaining("user")).toEqual({
      remaining: 0,
      reset: 0,
      limit: 0
    });
  });

  it("fails open when Redis does not answer within the timeout", async () => {
    vi.useFakeTimers();
    const silent = {
      eval: () => new Promise(() => undefined)
    } as unknown as Redis;
    const pending = base({ redis: silent, timeout: 1000 }).limit("user");
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toMatchObject(failOpen);
  });
});

describe("blockUntilReady", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
    vi.setSystemTime(minutes(30) + 500);
  });

  it("waits until a call is allowed", async () => {
    // A 1 s sliding window: at :01 the call at :00.5 still counts in full, so
    // the first free moment is :02.
    const ratelimit = base({ limiter: Ratelimit.slidingWindow(1, "1 s") });
    await ratelimit.limit("user");
    let result: { success: boolean } | undefined;
    const pending = ratelimit.blockUntilReady("user", 5000).then((r) => {
      result = r;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(result?.success).toBe(true);
  });

  it("gives up blocked at the deadline", async () => {
    const ratelimit = base({ limiter: Ratelimit.slidingWindow(1, "1 h") });
    await ratelimit.limit("user");
    const pending = ratelimit.blockUntilReady("user", 300);
    await vi.advanceTimersByTimeAsync(300);
    expect((await pending).success).toBe(false);
  });

  it.each([0, -1])("refuses a timeout of %s", async (timeout) => {
    await expect(base().blockUntilReady("user", timeout)).rejects.toThrow(
      "timeout must be positive"
    );
  });
});
