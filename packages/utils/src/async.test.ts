import { describe, expect, it, vi } from "vitest";
import { background, map } from "./async";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("async.map", () => {
  it("keeps input order regardless of completion order", async () => {
    const result = await map([30, 10, 20], async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(result).toEqual([30, 10, 20]);
  });

  it("never runs more than `concurrency` calls at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await map(
      Array.from({ length: 10 }, (_, i) => i),
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight--;
      },
      { concurrency: 3 }
    );
    expect(peak).toBe(3);
  });

  it("rejects with the first error and starts no further calls", async () => {
    const seen: number[] = [];
    await expect(
      map(
        [1, 2, 3, 4],
        async (n) => {
          seen.push(n);
          if (n === 2) throw new Error("boom");
        },
        { concurrency: 1 }
      )
    ).rejects.toThrow("boom");
    expect(seen).toEqual([1, 2]);
  });

  it("returns [] for no items", async () => {
    expect(await map([], async () => 1)).toEqual([]);
  });
});

describe("async.background", () => {
  it("routes a rejection to onError instead of the process", async () => {
    const onError = vi.fn();
    background(async () => {
      throw new Error("late");
    }, onError);
    await tick();
    expect(onError).toHaveBeenCalledWith(new Error("late"));
  });

  it("routes a synchronous throw to onError", async () => {
    const onError = vi.fn();
    background(() => {
      throw new Error("sync");
    }, onError);
    await tick();
    expect(onError).toHaveBeenCalledWith(new Error("sync"));
  });
});
