import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import type { Kysely } from "kysely";
import type { DB } from "../database.ts";
import type { ScheduledOperation } from "./types.ts";
import {
  applyWorkCenterSelections,
  hasPreassignedWorkCenter,
  WorkCenterSelector,
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

Deno.test(
  "selectWorkCentersForOperations skips auto-select for pre-assigned WCs but tracks load",
  async () => {
    const selector = new WorkCenterSelector(
      null as unknown as Kysely<DB>,
      "co-1",
      "loc-1"
    );

    let autoSelectCalls = 0;
    // Avoid DB: stub selection for unassigned ops only
    (selector as unknown as {
      selectWorkCenter: WorkCenterSelector["selectWorkCenter"];
    }).selectWorkCenter = async () => {
      autoSelectCalls += 1;
      return { workCenterId: "auto-wc", priority: 0, load: 0 };
    };

    const operations = [
      makeOp({
        id: "op-pre",
        workCenterId: "user-wc",
        startDate: "2026-08-10",
        durationHours: 5,
      }),
      makeOp({
        id: "op-open",
        workCenterId: null,
        startDate: "2026-08-11",
        durationHours: 3,
      }),
      makeOp({
        id: "op-empty",
        workCenterId: "",
        startDate: "2026-08-12",
        durationHours: 1,
      }),
    ];

    const selections = await selector.selectWorkCentersForOperations(
      operations
    );

    // Pre-assigned: keep user WC, do not call auto-select for that op
    assertEquals(selections.get("op-pre")?.workCenterId, "user-wc");
    // Null and empty string still auto-selected
    assertEquals(selections.get("op-open")?.workCenterId, "auto-wc");
    assertEquals(selections.get("op-empty")?.workCenterId, "auto-wc");
    assertEquals(autoSelectCalls, 2);

    // Load from pre-assigned op is counted for balancing
    assertEquals(selector.getInMemoryLoad("user-wc"), 5);
    assertEquals(selector.getInMemoryLoad("auto-wc"), 4); // 3 + 1
  }
);

Deno.test(
  "selectWorkCentersForOperations skips Outside Processing ops",
  async () => {
    const selector = new WorkCenterSelector(
      null as unknown as Kysely<DB>,
      "co-1",
      "loc-1"
    );

    let autoSelectCalls = 0;
    (selector as unknown as {
      selectWorkCenter: WorkCenterSelector["selectWorkCenter"];
    }).selectWorkCenter = async () => {
      autoSelectCalls += 1;
      return { workCenterId: "auto-wc", priority: 0 };
    };

    const selections = await selector.selectWorkCentersForOperations([
      makeOp({
        id: "op-out",
        operationType: "Outside Processing",
        workCenterId: null,
      }),
    ]);

    assert(!selections.has("op-out"));
    assertEquals(autoSelectCalls, 0);
  }
);
