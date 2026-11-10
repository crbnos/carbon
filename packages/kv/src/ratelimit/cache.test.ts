// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "./cache";

describe("Cache.isBlocked", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not block a key that was never blocked", () => {
    expect(new Cache().isBlocked("user:1")).toEqual({
      blocked: false,
      reset: 0
    });
  });

  it("blocks a key until its reset time", () => {
    const cache = new Cache();
    cache.blockUntil("user:1", 1_010_000);
    vi.advanceTimersByTime(9_999);
    expect(cache.isBlocked("user:1")).toEqual({
      blocked: true,
      reset: 1_010_000
    });
  });

  it("unblocks and forgets a key once its reset time is reached", () => {
    const cache = new Cache();
    cache.blockUntil("user:1", 1_010_000);
    vi.advanceTimersByTime(10_000);
    expect(cache.isBlocked("user:1")).toEqual({ blocked: false, reset: 0 });
    expect(cache.get("user:1")).toBeUndefined();
  });
});
