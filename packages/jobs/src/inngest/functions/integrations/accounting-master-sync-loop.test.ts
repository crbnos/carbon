// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";
import { runUnmappedPushLoop } from "./accounting-master-sync-loop";

/**
 * `getUnsyncedEntityIds` applies its `limit` with no `ORDER BY`, so the loop
 * cannot assume a second read advances. These fixtures model the real database
 * behaviour: an unmapped pool, read with whatever `limit` the loop asks for,
 * always from the front.
 */
function unmappedPool(ids: string[]) {
  const pool = [...ids];
  const requestedLimits: number[] = [];
  return {
    pool,
    requestedLimits,
    /** The page a plan-order (no ORDER BY) read returns: the head of the pool. */
    read: async (limit: number) => {
      requestedLimits.push(limit);
      return pool.slice(0, limit);
    },
    /** A successful push maps the record, so it leaves the unmapped pool. */
    map: (ids: string[]) => {
      for (const id of ids) {
        const at = pool.indexOf(id);
        if (at >= 0) pool.splice(at, 1);
      }
    }
  };
}

/**
 * A batch outcome. `claimed` defaults to the batch size — the realistic value,
 * since the drain claims what the batch just enqueued. The one test that cares
 * passes it explicitly.
 */
const counts = (
  entityIds: string[],
  over: Partial<
    Record<"succeeded" | "skipped" | "failed" | "claimed", number>
  > = {}
) => ({
  succeeded: 0,
  skipped: 0,
  failed: 0,
  claimed: entityIds.length,
  ...over
});

describe("runUnmappedPushLoop", () => {
  it("attempts every record even when the first page fails", async () => {
    // The bug this pins: batch 0's pushes all fail, so its records stay
    // unmapped and the unordered read hands back the SAME page. Re-enqueueing
    // them resolves to the Failed ledger rows already there, nothing new is
    // Pending, the drain claims nothing — and the loop used to stop, leaving
    // every record behind the failing page unattempted while reporting
    // "complete".
    const source = unmappedPool(["a", "b", "c", "d", "e", "f"]);
    const batches: string[][] = [];

    const result = await runUnmappedPushLoop({
      batchSize: 2,
      maxBatches: 10,
      fetchCandidateIds: (limit) => source.read(limit),
      runBatch: async (_index, entityIds) => {
        batches.push(entityIds);
        // Every push fails, so nothing ever becomes mapped and nothing is
        // claimable on the re-read.
        return counts(entityIds, { failed: entityIds.length });
      },
      delay: vi.fn(async () => undefined)
    });

    expect(batches).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"]
    ]);
    expect(result.failed).toBe(6);
    // No record is ever handed to two batches.
    expect(new Set(batches.flat()).size).toBe(6);
  });

  it("asks for enough candidates to see past what it already attempted", async () => {
    const source = unmappedPool(["a", "b", "c", "d"]);

    await runUnmappedPushLoop({
      batchSize: 2,
      maxBatches: 10,
      fetchCandidateIds: (limit) => source.read(limit),
      runBatch: async (_index, entityIds) =>
        counts(entityIds, { failed: entityIds.length }),
      delay: vi.fn(async () => undefined)
    });

    // batchSize, then batchSize + the 2 already attempted, then + 4.
    expect(source.requestedLimits).toEqual([2, 4, 6]);
  });

  it("still drains a pool that shrinks as records map", async () => {
    const source = unmappedPool(["a", "b", "c", "d", "e"]);
    const batches: string[][] = [];

    const result = await runUnmappedPushLoop({
      batchSize: 2,
      maxBatches: 10,
      fetchCandidateIds: (limit) => source.read(limit),
      runBatch: async (_index, entityIds) => {
        batches.push(entityIds);
        source.map(entityIds);
        return counts(entityIds, { succeeded: entityIds.length });
      },
      delay: vi.fn(async () => undefined)
    });

    expect(batches).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(result.succeeded).toBe(5);
  });

  it("does not stop on a zero claim", async () => {
    // `claimed` is the drain's whole company-wide count, so it says nothing
    // about this batch's progress: an unrelated pending operation inflates it,
    // and a batch whose enqueues were all absorbed reports zero while records
    // remain. It must not be a stop condition.
    const source = unmappedPool(["a", "b", "c", "d"]);
    const attempts: string[][] = [];

    await runUnmappedPushLoop({
      batchSize: 2,
      maxBatches: 10,
      fetchCandidateIds: (limit) => source.read(limit),
      runBatch: async (_index, entityIds) => {
        attempts.push(entityIds);
        return counts(entityIds, { failed: entityIds.length, claimed: 0 });
      },
      delay: vi.fn(async () => undefined)
    });

    expect(attempts.flat()).toEqual(["a", "b", "c", "d"]);
  });

  it("stops at maxBatches", async () => {
    const source = unmappedPool(
      Array.from({ length: 50 }, (_value, index) => `id-${index}`)
    );
    const attempts: string[][] = [];

    await runUnmappedPushLoop({
      batchSize: 2,
      maxBatches: 3,
      fetchCandidateIds: (limit) => source.read(limit),
      runBatch: async (_index, entityIds) => {
        attempts.push(entityIds);
        return counts(entityIds, { failed: entityIds.length });
      },
      delay: vi.fn(async () => undefined)
    });

    expect(attempts).toHaveLength(3);
  });

  it("pauses between full batches, never after the last one", async () => {
    const source = unmappedPool(["a", "b", "c"]);
    const delays: number[] = [];

    await runUnmappedPushLoop({
      batchSize: 2,
      maxBatches: 10,
      fetchCandidateIds: (limit) => source.read(limit),
      runBatch: async (_index, entityIds) =>
        counts(entityIds, { failed: entityIds.length }),
      delay: async (index) => {
        delays.push(index);
      }
    });

    // Two batches ran ("a","b" then "c"); only the first was full.
    expect(delays).toEqual([0]);
  });
});
