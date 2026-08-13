import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { applyWorkCenterSelections } from "./apply-work-center-selections.ts";
import type { ScheduledOperation, WorkCenterSelection } from "./types.ts";

function makeOp(overrides: Partial<ScheduledOperation> = {}): ScheduledOperation {
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
    ...overrides,
  };
}

const PRIOR_CONFLICT =
  "Operation must start on 2026-07-13 but current date is 2026-07-14";

Deno.test("finite placement sets dates and clears any prior conflict", () => {
  const ops = new Map<string, ScheduledOperation>([
    [
      "op-1",
      makeOp({ hasConflict: true, conflictReason: PRIOR_CONFLICT }),
    ],
  ]);
  const selections = new Map<string, WorkCenterSelection>([
    [
      "op-1",
      {
        workCenterId: "wc-1",
        priority: 0,
        placedStart: "2026-07-14T00:00:00.000Z",
        placedEnd: "2026-07-14T08:00:00.000Z",
        conflict: null,
      },
    ],
  ]);

  const result = applyWorkCenterSelections(ops, selections);
  const op = result.get("op-1");
  assert(op);
  assertEquals(op.startDate, "2026-07-14");
  assertEquals(op.dueDate, "2026-07-14");
  assertEquals(op.hasConflict, false);
  assertEquals(op.conflictReason, null);
});

Deno.test("late finite placement records the finite conflict reason", () => {
  const ops = new Map<string, ScheduledOperation>([
    [
      "op-1",
      makeOp({ hasConflict: true, conflictReason: PRIOR_CONFLICT }),
    ],
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
        conflict: finiteReason,
      },
    ],
  ]);

  const result = applyWorkCenterSelections(ops, selections);
  const op = result.get("op-1");
  assert(op);
  assertEquals(op.hasConflict, true);
  assertEquals(op.conflictReason, finiteReason);
});

Deno.test("selection without a placement leaves the op's dates and conflict untouched (e.g. a pin)", () => {
  const ops = new Map<string, ScheduledOperation>([
    [
      "op-1",
      makeOp({ hasConflict: true, conflictReason: PRIOR_CONFLICT }),
    ],
  ]);
  const selections = new Map<string, WorkCenterSelection>([
    ["op-1", { workCenterId: "wc-1", priority: 0 }],
  ]);

  const result = applyWorkCenterSelections(ops, selections);
  const op = result.get("op-1");
  assert(op);
  assertEquals(op.startDate, "2026-07-13");
  assertEquals(op.hasConflict, true);
  assertEquals(op.conflictReason, PRIOR_CONFLICT);
});

Deno.test("outside placement (no work center) applies dates and clears any prior conflict", () => {
  const ops = new Map<string, ScheduledOperation>([
    [
      "op-1",
      makeOp({
        startDate: "2026-06-17",
        dueDate: "2026-06-18",
        hasConflict: true,
        conflictReason: PRIOR_CONFLICT,
      }),
    ],
  ]);
  const selections = new Map<string, WorkCenterSelection>([
    [
      "op-1",
      {
        workCenterId: null,
        priority: 0,
        placedStart: "2026-07-15T08:00:00.000Z",
        placedEnd: "2026-07-15T08:00:00.000Z",
        conflict: null,
      },
    ],
  ]);

  const result = applyWorkCenterSelections(ops, selections);
  const op = result.get("op-1");
  assert(op);
  assertEquals(op.workCenterId, undefined);
  assertEquals(op.startDate, "2026-07-15");
  assertEquals(op.dueDate, "2026-07-15");
  assertEquals(op.hasConflict, false);
  assertEquals(op.conflictReason, null);
});

Deno.test("operation without a selection passes through unchanged", () => {
  const original = makeOp({
    hasConflict: true,
    conflictReason: PRIOR_CONFLICT,
  });
  const ops = new Map<string, ScheduledOperation>([["op-1", original]]);

  const result = applyWorkCenterSelections(
    ops,
    new Map<string, WorkCenterSelection>()
  );
  assertEquals(result.get("op-1"), original);
});

Deno.test("placed dates are recorded as the factory's calendar day", () => {
  const ops = new Map<string, ScheduledOperation>([["op-1", makeOp({})]]);
  const selections = new Map<string, WorkCenterSelection>([
    [
      "op-1",
      {
        workCenterId: "wc-1",
        priority: 0,
        // 21:34 UTC on the 20th = 03:04 IST on the 21st
        placedStart: "2026-07-19T22:00:00.000Z",
        placedEnd: "2026-07-20T21:34:00.000Z",
        conflict: null,
      },
    ],
  ]);

  const utc = applyWorkCenterSelections(ops, selections).get("op-1")!;
  assertEquals(utc.startDate, "2026-07-19");
  assertEquals(utc.dueDate, "2026-07-20");

  const ist = applyWorkCenterSelections(ops, selections, "Asia/Kolkata").get(
    "op-1"
  )!;
  assertEquals(ist.startDate, "2026-07-20");
  assertEquals(ist.dueDate, "2026-07-21");
});
