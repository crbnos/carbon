import { it } from "vitest";
import { applyWorkCenterSelections } from "./apply-work-center-selections.ts";
import { assert, assertEquals } from "./test-helpers.ts";
import type { ScheduledOperation, WorkCenterSelection } from "./types.ts";

function makeOp(
  overrides: Partial<ScheduledOperation> = {}
): ScheduledOperation {
  return {
    id: "op-1",
    jobId: "job-1",
    processId: "process-1",
    startDate: "2026-07-13",
    dueDate: "2026-07-14",
    priority: 1,
    durationHours: 8,
    durationDays: 1,
    hasConflict: false,
    conflictReason: null,
    ...overrides
  };
}

const PRIOR_CONFLICT =
  "Operation must start on 2026-07-13 but current date is 2026-07-14";

it("finite placement sets dates and clears any prior conflict", () => {
  const ops = new Map<string, ScheduledOperation>([
    ["op-1", makeOp({ hasConflict: true, conflictReason: PRIOR_CONFLICT })]
  ]);
  const selections = new Map<string, WorkCenterSelection>([
    [
      "op-1",
      {
        workCenterId: "wc-1",
        priority: 0,
        placedStart: "2026-07-14T00:00:00.000Z",
        placedEnd: "2026-07-14T08:00:00.000Z",
        conflict: null
      }
    ]
  ]);

  const result = applyWorkCenterSelections(ops, selections);
  const op = result.get("op-1");
  assert(op);
  assertEquals(op.startDate, "2026-07-14");
  // The forecast is the EXACT placed-end instant; the stored need-by target
  // (dueDate) is never touched by the forward pass.
  assertEquals(op.projectedCompletionAt, "2026-07-14T08:00:00.000Z");
  assertEquals(op.dueDate, "2026-07-14");
  assertEquals(op.hasConflict, false);
  assertEquals(op.conflictReason, null);
});

it("late finite placement records the finite conflict reason", () => {
  const ops = new Map<string, ScheduledOperation>([
    ["op-1", makeOp({ hasConflict: true, conflictReason: PRIOR_CONFLICT })]
  ]);
  const finiteReason =
    "Finishes 2026-07-16 but the job is due 2026-07-14 — waited for the work center, queued behind J000009 (2 ops)";
  const selections = new Map<string, WorkCenterSelection>([
    [
      "op-1",
      {
        workCenterId: "wc-1",
        priority: 0,
        placedStart: "2026-07-15T00:00:00.000Z",
        placedEnd: "2026-07-16T08:00:00.000Z",
        conflict: finiteReason
      }
    ]
  ]);

  const result = applyWorkCenterSelections(ops, selections);
  const op = result.get("op-1");
  assert(op);
  assertEquals(op.hasConflict, true);
  assertEquals(op.conflictReason, finiteReason);
});

it("selection without a placement leaves the op's dates and conflict untouched (e.g. a pin)", () => {
  const ops = new Map<string, ScheduledOperation>([
    ["op-1", makeOp({ hasConflict: true, conflictReason: PRIOR_CONFLICT })]
  ]);
  const selections = new Map<string, WorkCenterSelection>([
    ["op-1", { workCenterId: "wc-1", priority: 0 }]
  ]);

  const result = applyWorkCenterSelections(ops, selections);
  const op = result.get("op-1");
  assert(op);
  assertEquals(op.startDate, "2026-07-13");
  assertEquals(op.hasConflict, true);
  assertEquals(op.conflictReason, PRIOR_CONFLICT);
});

it("outside placement (no work center) applies dates and clears any prior conflict", () => {
  const ops = new Map<string, ScheduledOperation>([
    [
      "op-1",
      makeOp({
        startDate: "2026-06-17",
        dueDate: "2026-06-18",
        hasConflict: true,
        conflictReason: PRIOR_CONFLICT
      })
    ]
  ]);
  const selections = new Map<string, WorkCenterSelection>([
    [
      "op-1",
      {
        workCenterId: null,
        priority: 0,
        placedStart: "2026-07-15T08:00:00.000Z",
        placedEnd: "2026-07-15T08:00:00.000Z",
        conflict: null
      }
    ]
  ]);

  const result = applyWorkCenterSelections(ops, selections);
  const op = result.get("op-1");
  assert(op);
  assertEquals(op.workCenterId, undefined);
  assertEquals(op.startDate, "2026-07-15");
  assertEquals(op.projectedCompletionAt, "2026-07-15T08:00:00.000Z");
  // The stored need-by target is untouched by placement.
  assertEquals(op.dueDate, "2026-06-18");
  assertEquals(op.hasConflict, false);
  assertEquals(op.conflictReason, null);
});

it("operation without a selection passes through unchanged", () => {
  const original = makeOp({
    hasConflict: true,
    conflictReason: PRIOR_CONFLICT
  });
  const ops = new Map<string, ScheduledOperation>([["op-1", original]]);

  const result = applyWorkCenterSelections(
    ops,
    new Map<string, WorkCenterSelection>()
  );
  assertEquals(result.get("op-1"), original);
});

it("placed start is recorded as the factory's calendar day; the projected finish keeps its exact instant", () => {
  const ops = new Map<string, ScheduledOperation>([["op-1", makeOp({})]]);
  const selections = new Map<string, WorkCenterSelection>([
    [
      "op-1",
      {
        workCenterId: "wc-1",
        priority: 0,
        // 22:00 UTC on the 19th = 03:30 IST on the 20th
        placedStart: "2026-07-19T22:00:00.000Z",
        placedEnd: "2026-07-20T21:34:00.000Z",
        conflict: null
      }
    ]
  ]);

  const utc = applyWorkCenterSelections(ops, selections).get("op-1")!;
  assertEquals(utc.startDate, "2026-07-19");
  assertEquals(utc.projectedCompletionAt, "2026-07-20T21:34:00.000Z");

  const ist = applyWorkCenterSelections(ops, selections, "Asia/Kolkata").get(
    "op-1"
  )!;
  assertEquals(ist.startDate, "2026-07-20");
  // The instant is timezone-independent — no business-day rounding.
  assertEquals(ist.projectedCompletionAt, "2026-07-20T21:34:00.000Z");
  // The stored need-by target survives in every zone.
  assertEquals(ist.dueDate, "2026-07-14");
});
