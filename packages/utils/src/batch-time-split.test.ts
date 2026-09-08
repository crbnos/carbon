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
  it("produces contiguous windows that tile the recorded span", () => {
    const windows = sliceEventByWeight(
      {
        startTime: "2026-07-14T00:00:00.000Z",
        endTime: "2026-07-14T01:10:00.000Z"
      },
      [
        { id: "a", weight: 5 },
        { id: "b", weight: 20 },
        { id: "c", weight: 10 }
      ]
    );
    const [a, b, c] = windows;
    // Durations follow the proportional split.
    expect(windows.map((w) => w.durationSeconds)).toEqual([600, 2400, 1200]);
    // Windows are contiguous: each starts where the previous ended.
    expect(a!.startTime).toBe("2026-07-14T00:00:00.000Z");
    expect(a!.endTime).toBe(b!.startTime);
    expect(b!.endTime).toBe(c!.startTime);
    // Last window closes out the parent span exactly.
    expect(c!.endTime).toBe("2026-07-14T01:10:00.000Z");
  });
});

describe("buildBatchCompletionPlan", () => {
  // The AC[6] scenario: members with qty 5/20/10, one 70-minute machine event,
  // scrap entered only on the middle member.
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
    endTime: "2026-07-14T01:10:00.000Z", // 70 minutes
    workCenterId: "wc-1",
    employeeId: "emp-1"
  };

  it("slices the 70-minute event into 10/40/20-minute per-member events", () => {
    const plan = buildBatchCompletionPlan([machineEvent], members);

    expect(plan.memberEvents.map((e) => e.durationSeconds)).toEqual([
      10 * 60,
      40 * 60,
      20 * 60
    ]);
    // Each slice keeps its own member + the source event's metadata.
    expect(plan.memberEvents.map((e) => e.jobOperationId)).toEqual([
      "op-a",
      "op-b",
      "op-c"
    ]);
    expect(plan.memberEvents.every((e) => e.type === "Machine")).toBe(true);
    expect(plan.memberEvents.every((e) => e.sourceEventId === "evt-1")).toBe(
      true
    );
    expect(plan.memberEvents.every((e) => e.workCenterId === "wc-1")).toBe(
      true
    );

    // Windows are contiguous and tile the parent span exactly.
    const [a, b, c] = plan.memberEvents;
    expect(a!.startTime).toBe("2026-07-14T00:00:00.000Z");
    expect(a!.endTime).toBe(b!.startTime);
    expect(b!.endTime).toBe(c!.startTime);
    expect(c!.endTime).toBe("2026-07-14T01:10:00.000Z");
  });

  it("emits a Production row per member and a Scrap row only where entered", () => {
    const plan = buildBatchCompletionPlan([machineEvent], members);

    expect(plan.quantities).toEqual([
      { jobOperationId: "op-a", type: "Production", quantity: 5 },
      { jobOperationId: "op-b", type: "Production", quantity: 20 },
      { jobOperationId: "op-b", type: "Scrap", quantity: 2 },
      { jobOperationId: "op-c", type: "Production", quantity: 10 }
    ]);
  });

  it("handles a batch with no recorded events (quantities still produced)", () => {
    const plan = buildBatchCompletionPlan([], members);
    expect(plan.memberEvents).toEqual([]);
    expect(plan.quantities.filter((q) => q.type === "Production")).toHaveLength(
      3
    );
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
  it("allows changing the work center of a Planned batch", () => {
    // Planned is the staged, pre-release state — nothing has run, so the
    // work center is still freely assignable.
    expect(() => assertBatchWorkCenterMutable("Planned")).not.toThrow();
  });

  it("allows changing the work center of an Active batch", () => {
    expect(() => assertBatchWorkCenterMutable("Active")).not.toThrow();
  });

  it("rejects changing the work center of a Completing batch", () => {
    expect(() => assertBatchWorkCenterMutable("Completing")).toThrow(
      /not active/
    );
  });

  it("rejects changing the work center of a Completed batch", () => {
    expect(() => assertBatchWorkCenterMutable("Completed")).toThrow(
      /not active/
    );
  });

  it("rejects changing the work center of a Cancelled batch", () => {
    expect(() => assertBatchWorkCenterMutable("Cancelled")).toThrow(
      /not active/
    );
  });
});

describe("planBatchCompletion", () => {
  it("rejects a Planned batch (must be released first)", () => {
    // A Planned batch has never been released to the floor — nothing has run
    // against it, so there is nothing to complete.
    expect(() => planBatchCompletion("Planned")).toThrow(
      /Only an active batch can be completed/
    );
  });

  it("slices on the first attempt (Active batch)", () => {
    expect(planBatchCompletion("Active")).toBe("slice");
  });

  it("resumes an in-flight completion (Completing batch)", () => {
    // The two-phase flow: a prior attempt committed the timer slice + flipped the
    // batch to 'Completing', then a post-commit step (issue / Done / GL) failed.
    // A retry must RESUME the idempotent post-commit steps, never re-slice.
    expect(planBatchCompletion("Completing")).toBe("resume");
  });

  it("rejects an already-completed batch", () => {
    expect(() => planBatchCompletion("Completed")).toThrow(
      /already been completed/
    );
  });

  it("rejects a cancelled batch", () => {
    expect(() => planBatchCompletion("Cancelled")).toThrow(
      /Only an active batch can be completed/
    );
  });
});
