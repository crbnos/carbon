// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, describe, expect, it, vi } from "vitest";
import { withExponentialBackoff } from "./retry.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("withExponentialBackoff", () => {
  it("returns immediately on success", async () => {
    expect(await withExponentialBackoff(async () => "ready")).toBe("ready");
  });

  it.each([
    [0, [2500, 7500, 22500]],
    [0.5, [3750, 11250, 33750]],
    [0.999, [4997.5, 14992.5, 44977.5]]
  ])(
    "jitters each exponential delay with random value %s",
    async (random, expected) => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(random);
      let attempts = 0;
      const waits: number[] = [];
      const result = withExponentialBackoff(
        async () => {
          if (++attempts < 4) throw new Error("429");
          return "pulled";
        },
        {
          onRetry: (_error, _attempt, delay) => {
            waits.push(delay);
          }
        }
      );
      await vi.runAllTimersAsync();
      expect(await result).toBe("pulled");
      expect(waits).toEqual(expected);
    }
  );

  it("throws the final error when attempts are exhausted", async () => {
    vi.useFakeTimers();
    const error = new Error("429");
    const result = withExponentialBackoff(async () => {
      throw error;
    });
    const assertion = expect(result).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("throws at once an error retryIf refuses", async () => {
    let attempts = 0;
    const error = new Error("manifest unknown");
    await expect(
      withExponentialBackoff(
        async () => {
          attempts++;
          throw error;
        },
        { retryIf: () => false }
      )
    ).rejects.toBe(error);
    expect(attempts).toBe(1);
  });

  it("does not retry when only one attempt is allowed", async () => {
    let attempts = 0;
    const error = new Error("failed");
    await expect(
      withExponentialBackoff(
        async () => {
          attempts++;
          throw error;
        },
        { attempts: 1 }
      )
    ).rejects.toBe(error);
    expect(attempts).toBe(1);
  });
});
