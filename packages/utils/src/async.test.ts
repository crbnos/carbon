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

  it("returns an empty list for no items", async () => {
    expect(await async.map([], async (n: number) => n)).toEqual([]);
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

describe("async.all", () => {
  it("runs at most the limit at once", async () => {
    const g = gauge();
    const result = await async.all(
      {
        a: () => g.run("a"),
        b: () => g.run("b"),
        c: () => g.run("c"),
        d: () => g.run("d"),
        e: () => g.run("e")
      },
      { concurrency: 2 }
    );
    expect(result).toEqual({ a: "a", b: "b", c: "c", d: "d", e: "e" });
    expect(g.peak()).toBe(2);
  });

  it("does not deadlock on dependencies with a limit of one", async () => {
    const result = await async.all(
      {
        async total() {
          const [a, b] = await Promise.all([this.$.a, this.$.b]);
          return a + b;
        },
        async doubled() {
          return (await this.$.total) * 2;
        },
        async a() {
          await tick();
          return 1;
        },
        async b() {
          await tick();
          return 2;
        }
      },
      { concurrency: 1 }
    );
    expect(result).toEqual({ total: 3, doubled: 6, a: 1, b: 2 });
  });

  it("keeps the limit while tasks wait on each other", async () => {
    const g = gauge();
    await async.all(
      {
        a: () => g.run(1),
        b: () => g.run(2),
        async c() {
          return g.run((await this.$.a) + 1);
        },
        async d() {
          return g.run((await this.$.b) + 1);
        }
      },
      { concurrency: 2 }
    );
    expect(g.peak()).toBe(2);
  });

  it("starts nothing queued after a failure", async () => {
    const started: string[] = [];
    const task =
      (name: string, fails = false) =>
      async () => {
        started.push(name);
        await tick();
        if (fails) throw new Error(`${name} failed`);
        return name;
      };
    await expect(
      async.all(
        { a: task("a", true), b: task("b"), c: task("c") },
        { concurrency: 1 }
      )
    ).rejects.toThrow("a failed");
    await tick(20);
    expect(started).toEqual(["a"]);
  });
});

describe("async.all signals", () => {
  it("aborts this.$signal in running tasks when a sibling fails", async () => {
    let aborted: unknown;
    await expect(
      async.all({
        async slow() {
          this.$signal.addEventListener("abort", () => {
            aborted = this.$signal.reason;
          });
          await tick(20);
        },
        async broken() {
          throw new Error("broken");
        }
      })
    ).rejects.toThrow("broken");
    expect((aborted as Error).message).toBe("broken");
  });

  it("does not start queued tasks once the caller's signal aborts", async () => {
    const controller = new AbortController();
    const started: string[] = [];
    const result = async.all(
      {
        async a() {
          started.push("a");
          await tick(10);
          return this.$signal.aborted;
        },
        async b() {
          started.push("b");
        }
      },
      { concurrency: 1, signal: controller.signal }
    );
    await tick(2);
    controller.abort(new Error("cancelled"));
    await expect(result).rejects.toThrow("cancelled");
    expect(started).toEqual(["a"]);
  });
});

describe("async.allSettled", () => {
  it("leaves this.$signal alone when a task fails", async () => {
    const result = await async.allSettled({
      async broken(): Promise<number> {
        throw new Error("broken");
      },
      async after() {
        await tick();
        return this.$signal.aborted;
      }
    });
    expect(result.after).toEqual({ status: "fulfilled", value: false });
  });

  it("reports each outcome and fails a task whose dependency failed", async () => {
    const result = await async.allSettled(
      {
        async ok() {
          return 1;
        },
        async broken(): Promise<number> {
          throw new Error("broken");
        },
        async needsBroken() {
          return (await this.$.broken) + 1;
        }
      },
      { concurrency: 1 }
    );
    expect(result.ok).toEqual({ status: "fulfilled", value: 1 });
    expect(result.broken.status).toBe("rejected");
    expect(result.needsBroken.status).toBe("rejected");
  });
});

describe("async.background", () => {
  it("hands a failure to the error handler", async () => {
    const seen: unknown[] = [];
    async.background(
      async () => {
        throw new Error("lost");
      },
      (error) => seen.push(error)
    );
    await tick();
    expect((seen[0] as Error).message).toBe("lost");
  });
});
