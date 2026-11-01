// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  assertAllOperationsClaimed,
  assertBatchCompletionMembership,
  assertBatchWorkCenterMutable,
  buildBatchCompletionPlan,
  planBatchCompletion,
  sliceEventByWeight,
  splitSecondsByWeight
} from "./batch-time-split";

describe("splitSecondsByWeight", () => {
  it("splits a 70-minute event across qty 5/20/10 into 10/40/20 minutes", () => {
    const shares = splitSecondsByWeight(70 * 60, [
      { id: "a", weight: 5 },
      { id: "b", weight: 20 },
      { id: "c", weight: 10 }
    ]);
    expect(shares).toEqual([
      { id: "a", durationSeconds: 10 * 60 },
      { id: "b", durationSeconds: 40 * 60 },
      { id: "c", durationSeconds: 20 * 60 }
    ]);
  });

  it("uses largest-remainder so shares sum EXACTLY to the total", () => {
    const total = 100;
    const shares = splitSecondsByWeight(total, [
      { id: "a", weight: 1 },
      { id: "b", weight: 1 },
      { id: "c", weight: 1 }
    ]);
    expect(shares.reduce((s, x) => s + x.durationSeconds, 0)).toBe(total);
    // 33.33 each; leftover second goes to the first (tie broken by order).
    expect(shares.map((s) => s.durationSeconds)).toEqual([34, 33, 33]);
  });

  it("falls back to an even split when all weights are zero", () => {
    const shares = splitSecondsByWeight(90, [
      { id: "a", weight: 0 },
      { id: "b", weight: 0 },
      { id: "c", weight: 0 }
    ]);
    expect(shares.map((s) => s.durationSeconds)).toEqual([30, 30, 30]);
  });

  it("returns zero durations when the event has no duration", () => {
    expect(
      splitSecondsByWeight(0, [{ id: "a", weight: 5 }]).map(
        (s) => s.durationSeconds
      )
    ).toEqual([0]);
  });
});

describe("sliceEventByWeight", () => {
  it("tiles the recorded span with contiguous windows in proportion to weight", () => {
    expect(
      sliceEventByWeight(
        {
          startTime: "2026-07-14T00:00:00.000Z",
          endTime: "2026-07-14T01:10:00.000Z"
        },
        [
          { id: "a", weight: 5 },
          { id: "b", weight: 20 },
          { id: "c", weight: 10 }
        ]
      )
    ).toEqual([
      {
        id: "a",
        startTime: "2026-07-14T00:00:00.000Z",
        endTime: "2026-07-14T00:10:00.000Z",
        durationSeconds: 600
      },
      {
        id: "b",
        startTime: "2026-07-14T00:10:00.000Z",
        endTime: "2026-07-14T00:50:00.000Z",
        durationSeconds: 2400
      },
      {
        id: "c",
        startTime: "2026-07-14T00:50:00.000Z",
        endTime: "2026-07-14T01:10:00.000Z",
        durationSeconds: 1200
      }
    ]);
  });
});

describe("buildBatchCompletionPlan", () => {
  // Members with qty 5/20/10, one 70-minute machine event, scrap only on the middle one.
  const members = [
    { jobOperationId: "op-a", operationQuantity: 5, quantity: 5 },
    {
      jobOperationId: "op-b",
      operationQuantity: 20,
      quantity: 20,
      scrapQuantity: 2
    },
    { jobOperationId: "op-c", operationQuantity: 10, quantity: 10 }
  ];
  const machineEvent = {
    id: "evt-1",
    type: "Machine",
    startTime: "2026-07-14T00:00:00.000Z",
    endTime: "2026-07-14T01:10:00.000Z",
    workCenterId: "wc-1",
    employeeId: "emp-1"
  };
  const slice = {
    sourceEventId: "evt-1",
    type: "Machine",
    workCenterId: "wc-1",
    employeeId: "emp-1"
  };

  it("slices each event into one per-member event carrying the source's metadata", () => {
    expect(
      buildBatchCompletionPlan([machineEvent], members).memberEvents
    ).toEqual([
      {
        ...slice,
        jobOperationId: "op-a",
        startTime: "2026-07-14T00:00:00.000Z",
        endTime: "2026-07-14T00:10:00.000Z",
        durationSeconds: 600
      },
      {
        ...slice,
        jobOperationId: "op-b",
        startTime: "2026-07-14T00:10:00.000Z",
        endTime: "2026-07-14T00:50:00.000Z",
        durationSeconds: 2400
      },
      {
        ...slice,
        jobOperationId: "op-c",
        startTime: "2026-07-14T00:50:00.000Z",
        endTime: "2026-07-14T01:10:00.000Z",
        durationSeconds: 1200
      }
    ]);
  });

  it("emits a Production row per member and a Scrap row only where entered, with or without events", () => {
    const quantities = [
      { jobOperationId: "op-a", type: "Production", quantity: 5 },
      { jobOperationId: "op-b", type: "Production", quantity: 20 },
      { jobOperationId: "op-b", type: "Scrap", quantity: 2 },
      { jobOperationId: "op-c", type: "Production", quantity: 10 }
    ];
    expect(
      buildBatchCompletionPlan([machineEvent], members).quantities
    ).toEqual(quantities);
    expect(buildBatchCompletionPlan([], members)).toEqual({
      memberEvents: [],
      quantities
    });
  });
});

describe("assertBatchCompletionMembership", () => {
  it("passes when the submitted members exactly match actual membership", () => {
    expect(() =>
      assertBatchCompletionMembership(
        ["op-a", "op-b", "op-c"],
        ["op-c", "op-a", "op-b"]
      )
    ).not.toThrow();
  });

  it("rejects a duplicate submitted member", () => {
    expect(() =>
      assertBatchCompletionMembership(
        ["op-a", "op-a", "op-b"],
        ["op-a", "op-b"]
      )
    ).toThrow(/submitted more than once/);
  });

  it("rejects a submitted id that is not a member of the batch", () => {
    expect(() =>
      assertBatchCompletionMembership(["op-a", "op-x"], ["op-a", "op-b"])
    ).toThrow(/not a member of this batch/);
  });

  it("rejects when a real member is omitted from the submission", () => {
    expect(() =>
      assertBatchCompletionMembership(["op-a"], ["op-a", "op-b"])
    ).toThrow(/must be included to complete it/);
  });
});

describe("assertAllOperationsClaimed", () => {
  it("passes when every requested operation was claimed", () => {
    expect(() =>
      assertAllOperationsClaimed(["op-a", "op-b", "op-c"], 3)
    ).not.toThrow();
  });

  it("rejects when a concurrent batch claimed one of the operations", () => {
    // Two requested, but the `IS NULL` guard only matched one row — the other
    // was already batched by a racing transaction.
    expect(() => assertAllOperationsClaimed(["op-a", "op-b"], 1)).toThrow(
      /already claimed by another batch/
    );
  });

  it("counts distinct requested ids, not raw list length", () => {
    expect(() => assertAllOperationsClaimed(["op-a", "op-a"], 1)).not.toThrow();
  });
});

describe("assertBatchWorkCenterMutable", () => {
  it.each(["Planned", "Active"] as const)(
    "allows changing the work center of a %s batch",
    (status) => {
      expect(() => assertBatchWorkCenterMutable(status)).not.toThrow();
    }
  );

  it.each(["Completing", "Completed", "Cancelled"] as const)(
    "refuses changing the work center of a %s batch",
    (status) => {
      expect(() => assertBatchWorkCenterMutable(status)).toThrow(/not active/);
    }
  );
});

describe("planBatchCompletion", () => {
  it("slices an Active batch", () => {
    expect(planBatchCompletion("Active")).toBe("slice");
  });

  it("resumes a Completing batch rather than slicing it again", () => {
    // A prior attempt committed the slice; a post-commit step failed.
    expect(planBatchCompletion("Completing")).toBe("resume");
  });

  it.each([
    ["Planned", /Only an active batch can be completed/],
    ["Cancelled", /Only an active batch can be completed/],
    ["Completed", /already been completed/]
  ] as const)("refuses to complete a %s batch", (status, error) => {
    expect(() => planBatchCompletion(status)).toThrow(error);
  });
});
