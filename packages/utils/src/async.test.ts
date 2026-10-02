// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
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
    await expect(
      async.map(
        [1, 2, 3, 4, 5],
        async (n) => {
          started.push(n);
          // Item 1 is still running when item 2 fails.
          await tick(n === 1 ? 20 : 5);
          if (n === 2) throw new Error("two failed");
          return n;
        },
        { concurrency: 2 }
      )
    ).rejects.toThrow("two failed");
    await tick(30);
    expect(started).toEqual([1, 2]);
  });

  it("pulls a lazy input one element per free slot", async () => {
    const pulled: number[] = [];
    function* numbers() {
      for (let n = 1; n <= 5; n++) {
        pulled.push(n);
        yield n;
      }
    }
    const seen: number[][] = [];
    const result = await async.map(
      numbers(),
      async (n) => {
        seen.push([...pulled]);
        await tick();
        return n;
      },
      { concurrency: 2 }
    );
    expect(result).toEqual([1, 2, 3, 4, 5]);
    // When the first mapper starts, only two elements have been taken.
    expect(seen[0]).toEqual([1, 2]);
  });

  it("accepts an async iterable and promises as elements", async () => {
    async function* numbers() {
      yield 1;
      await tick();
      yield 2;
    }
    expect(await async.map(numbers(), (n) => n * 2)).toEqual([2, 4]);
    expect(
      await async.map([Promise.resolve(1), 2], (n, index) => n + index)
    ).toEqual([1, 3]);
  });

  it("leaves out elements whose mapper returns async.skip", async () => {
    const odd: number[] = await async.map([1, 2, 3, 4, 5], (n) =>
      n % 2 ? n : async.skip
    );
    expect(odd).toEqual([1, 3, 5]);
  });

  it("with stopOnError false runs everything, then rejects with every failure", async () => {
    const ran: number[] = [];
    const result = async.map(
      [1, 2, 3, 4],
      async (n) => {
        ran.push(n);
        if (n % 2 === 0) throw new Error(`${n} failed`);
        return n;
      },
      { concurrency: 2, stopOnError: false }
    );
    await expect(result).rejects.toBeInstanceOf(AggregateError);
    const error = (await result.catch((e) => e)) as AggregateError;
    expect(error.errors.map((e: Error) => e.message)).toEqual([
      "2 failed",
      "4 failed"
    ]);
    expect(ran).toEqual([1, 2, 3, 4]);
  });

  it("rejects with the signal's reason and starts nothing after it aborts", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const result = async.map(
      [1, 2, 3, 4],
      async (n) => {
        started.push(n);
        await tick(10);
        return n;
      },
      { concurrency: 1, signal: controller.signal }
    );
    await tick(2);
    controller.abort(new Error("cancelled"));
    await expect(result).rejects.toThrow("cancelled");
    await tick(30);
    expect(started).toEqual([1]);

    await expect(
      async.map([1], (n) => n, { signal: controller.signal })
    ).rejects.toThrow("cancelled");
  });

  it("runs everything at once with Infinity and rejects a bad limit", async () => {
    const g = gauge();
    await async.map([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], (n) => g.run(n), {
      concurrency: Number.POSITIVE_INFINITY
    });
    expect(g.peak()).toBe(10);
    await expect(
      async.map([1], (n) => n, { concurrency: 0 })
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe("async.limit", () => {
  it("runs at most the limit at once, in call order", async () => {
    const g = gauge();
    const limit = async.limit(2);
    const order: number[] = [];
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        limit(async () => {
          order.push(n);
          return g.run(n);
        })
      )
    );
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(g.peak()).toBe(2);
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
