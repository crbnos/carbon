// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, describe, expect, it } from "vitest";
import { async } from "./async";

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

/** Counts how many calls are in flight at once. */
function gauge() {
  let running = 0;
  let peak = 0;
  return {
    peak: () => peak,
    async run<T>(value: T, ms = 5) {
      peak = Math.max(peak, ++running);
      await tick(ms);
      running--;
      return value;
    }
  };
}

describe("async.map", () => {
  it("keeps input order and never runs more than the limit at once", async () => {
    const g = gauge();
    const items = [5, 1, 4, 2, 3, 6, 7];
    const doubled = await async.map(items, (n) => g.run(n * 2, n), {
      concurrency: 3
    });
    expect(doubled).toEqual([10, 2, 8, 4, 6, 12, 14]);
    expect(g.peak()).toBe(3);
  });

  it("rejects with the first failure and starts nothing after it", async () => {
    const started: number[] = [];
    // Item 1 is held open until item 2 has failed: no timers to race.
    let finishFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    await expect(
      async.map(
        [1, 2, 3, 4, 5],
        async (n) => {
          started.push(n);
          if (n === 1) await firstHeld;
          if (n === 2) throw new Error("two failed");
          return n;
        },
        { concurrency: 2 }
      )
    ).rejects.toThrow("two failed");
    finishFirst();
    await tick(5);
    expect(started).toEqual([1, 2]);
  });

  it("starts nothing when reading the input throws", () => {
    const started: number[] = [];
    function* broken() {
      yield 1;
      yield 2;
      throw new Error("input failed");
    }
    expect(() =>
      async.map(broken(), (n) => {
        started.push(n);
        return n;
      })
    ).toThrow("input failed");
    expect(started).toEqual([]);
  });

  it("rejects a limit that is not a positive integer or Infinity", () => {
    expect(() => async.map([1], (n) => n, { concurrency: 0 })).toThrow(
      TypeError
    );
  });
});

describe("async.all", () => {
  it("returns each task's result in order, under the limit", async () => {
    const g = gauge();
    const [count, name, flag] = await async.all(
      [() => g.run(1, 10), () => g.run("two"), () => g.run(true)],
      { concurrency: 2 }
    );
    expect([count, name, flag]).toEqual([1, "two", true]);
    expect(g.peak()).toBe(2);
  });
});

describe("async.allSettled", () => {
  it("runs every task under the limit and reports each outcome", async () => {
    const g = gauge();
    const results = await async.allSettled(
      [
        () => g.run(1),
        () => {
          throw new Error("sync failure");
        },
        () => g.run(3)
      ],
      { concurrency: 2 }
    );
    expect(results.map((r) => r.status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled"
    ]);
    expect(g.peak()).toBe(2);
  });
});

describe("async.limit", () => {
  it("runs at most the limit at once, in call order", async () => {
    const g = gauge();
    const limit = async.limit(2);
    const order: number[] = [];
    const calls = [1, 2, 3, 4, 5].map((n) =>
      limit(async () => {
        order.push(n);
        return g.run(n);
      })
    );
    expect(limit.activeCount).toBe(2);
    expect(limit.pendingCount).toBe(3);
    expect(await Promise.all(calls)).toEqual([1, 2, 3, 4, 5]);
    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(g.peak()).toBe(2);
    expect(limit.activeCount).toBe(0);
  });

  it("hands a freed slot to the queued call, not to one made while it resumes", async () => {
    const limit = async.limit(1);
    const order: string[] = [];
    let release!: () => void;
    const first = limit(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const second = limit(async () => {
      order.push("second");
    });
    await Promise.resolve();
    release();
    // Runs after the first call has freed its slot, before the second resumes.
    let third: Promise<void> | undefined;
    queueMicrotask(() => {
      third = limit(async () => {
        order.push("third");
      });
    });
    await Promise.all([first, second]);
    await third;
    expect(order).toEqual(["second", "third"]);
  });

  it("frees the slot when a call fails", async () => {
    const limit = async.limit(1);
    await expect(
      limit(async () => {
        throw new Error("failed");
      })
    ).rejects.toThrow("failed");
    expect(await limit(() => "next")).toBe("next");
  });
});

describe("async.onBackground", () => {
  afterEach(() => async.onBackground(undefined));

  it("hands every piece of background work to the host's hook, failures included", async () => {
    const kept: Promise<unknown>[] = [];
    async.onBackground((work) => kept.push(work));
    const done: string[] = [];
    async.background(
      async () => {
        await tick(10);
        done.push("slow");
      },
      () => undefined
    );
    async.background(
      async () => {
        throw new Error("lost");
      },
      () => done.push("failed")
    );
    expect(kept).toHaveLength(2);
    expect(done).toEqual([]);
    // What the host waits for settles only when the work has, and never rejects.
    await Promise.all(kept);
    expect(done.sort()).toEqual(["failed", "slow"]);
  });
});

describe("async.background", () => {
  it("contains a failure of the error handler itself", async () => {
    const kept: Promise<unknown>[] = [];
    async.onBackground((work) => kept.push(work));
    async.background(
      () => {
        throw new Error("task failed");
      },
      () => {
        throw new Error("handler failed");
      }
    );
    await expect(kept[0]).resolves.toBeUndefined();
    async.onBackground(undefined);
  });
});
