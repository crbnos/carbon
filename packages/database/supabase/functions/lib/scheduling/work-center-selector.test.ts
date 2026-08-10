import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import type { ScheduledOperation } from "./types.ts";
import {
  applyWorkCenterSelections,
  hasPreassignedWorkCenter,
} from "./work-center-selector.ts";

function makeOp(
  overrides: Partial<ScheduledOperation> & { id: string }
): ScheduledOperation {
  return {
    jobId: "job-1",
    processId: "proc-1",
    startDate: "2026-08-10",
    dueDate: "2026-08-11",
    priority: 1,
    durationHours: 2,
    durationDays: 1,
    hasConflict: false,
    conflictReason: null,
    workCenterId: null,
    ...overrides,
  };
}

Deno.test("hasPreassignedWorkCenter is true only for non-empty ids", () => {
  assertEquals(hasPreassignedWorkCenter("wc-1"), true);
  assertEquals(hasPreassignedWorkCenter(null), false);
  assertEquals(hasPreassignedWorkCenter(undefined), false);
  assertEquals(hasPreassignedWorkCenter(""), false);
});

Deno.test("applyWorkCenterSelections does not overwrite pre-assigned work centers", () => {
  const ops = new Map<string, ScheduledOperation>([
    ["op-pre", makeOp({ id: "op-pre", workCenterId: "user-wc" })],
    ["op-new", makeOp({ id: "op-new", workCenterId: null })],
  ]);
  const selections = new Map([
    ["op-pre", { workCenterId: "auto-wc", priority: 0 }],
    ["op-new", { workCenterId: "auto-wc", priority: 0 }],
  ]);

  const result = applyWorkCenterSelections(ops, selections);

  assertEquals(result.get("op-pre")?.workCenterId, "user-wc");
  assertEquals(result.get("op-new")?.workCenterId, "auto-wc");
});

Deno.test("applyWorkCenterSelections leaves ops untouched when selection has no WC", () => {
  const ops = new Map<string, ScheduledOperation>([
    ["op-1", makeOp({ id: "op-1", workCenterId: null })],
  ]);
  const selections = new Map([
    ["op-1", { workCenterId: null, priority: 0, error: "no process" }],
  ]);

  const result = applyWorkCenterSelections(ops, selections);
  assertEquals(result.get("op-1")?.workCenterId, null);
});
