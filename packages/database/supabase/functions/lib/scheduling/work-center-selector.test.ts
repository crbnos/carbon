import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import type { ScheduledOperation } from "./types.ts";
import type { MasterDataProvider } from "./master-data-provider.ts";
import {
  applyWorkCenterSelections,
  type FiniteSchedulingContext,
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

// --- remaining-work netting at the selector level ---------------------------

function makeContext(
  overrides: Partial<FiniteSchedulingContext> = {}
): FiniteSchedulingContext {
  const now = new Date("2026-01-05T00:00:00.000Z"); // Monday
  const windowsEnd = new Date("2026-02-05T00:00:00.000Z");
  return {
    capacityByWorkCenter: new Map([
      [
        "wc1",
        {
          workCenter: { id: "wc1" },
          // one continuous window (alwaysOn-equivalent) so hours == wall clock
          windows: [{ start: now, end: windowsEnd }],
          reservations: [],
        },
      ],
    ]),
    requirementByProcess: new Map(),
    employeesByAbility: new Map(),
    reservationsByEmployee: new Map(),
    dependencies: [],
    now,
    horizonDays: 365,
    windowsEnd,
    peopleByWorkCenter: new Map(),
    peopleBudgets: new Map(),
    windowsByEmployee: new Map(),
    timeZone: "UTC",
    operationsWithEvents: new Set<string>(),
    ...overrides,
  };
}

Deno.test("a half-complete op with a production event books half the hours", async () => {
  // Ungated op, sticky on wc1: 4h of labor, 50% complete, setup already done
  // (production event) → nets to 2h. A full op would book 4h.
  const selector = new WorkCenterSelector(
    {} as unknown as MasterDataProvider,
    "loc1"
  );
  selector.setFiniteContext(
    makeContext({ operationsWithEvents: new Set(["op-1"]) })
  );

  const op = makeOp({
    id: "op-1",
    workCenterId: "wc1",
    startDate: null,
    dueDate: null,
    setupTime: 0,
    laborTime: 4,
    laborUnit: "Total Hours",
    machineTime: 0,
    operationQuantity: 10,
    quantityComplete: 5,
  });

  const selections = await selector.selectWorkCentersForOperations([op], {
    jobDueDate: null,
  });

  const selection = selections.get("op-1");
  assert(selection?.placedStart && selection.placedEnd);
  const spanMs =
    new Date(selection.placedEnd).getTime() -
    new Date(selection.placedStart).getTime();
  assertEquals(spanMs, 2 * 60 * 60 * 1000); // 2h, not the full 4h

  const reservation = selector
    .getPlannedReservations()
    .find((r) => r.operationId === "op-1" && r.resourceKind === "WorkCenter");
  assertEquals(reservation?.workHours, 2);
});

Deno.test("an untouched op books the full standard hours", async () => {
  const selector = new WorkCenterSelector(
    {} as unknown as MasterDataProvider,
    "loc1"
  );
  selector.setFiniteContext(makeContext());

  const op = makeOp({
    id: "op-1",
    workCenterId: "wc1",
    startDate: null,
    dueDate: null,
    setupTime: 0,
    laborTime: 4,
    laborUnit: "Total Hours",
    machineTime: 0,
    operationQuantity: 10,
    quantityComplete: 0,
  });

  const selections = await selector.selectWorkCentersForOperations([op], {
    jobDueDate: null,
  });
  const selection = selections.get("op-1");
  assert(selection?.placedStart && selection.placedEnd);
  const spanMs =
    new Date(selection.placedEnd).getTime() -
    new Date(selection.placedStart).getTime();
  assertEquals(spanMs, 4 * 60 * 60 * 1000); // full 4h
});

// --- load balancing across equivalent work centers --------------------------

Deno.test("two identical not-started ops spread across equivalent work centers", async () => {
  const now = new Date("2026-01-05T00:00:00.000Z"); // Monday
  const windowsEnd = new Date("2026-02-05T00:00:00.000Z");

  // proc-1 runs on wc1 AND wc2 (interchangeable); both active at the location.
  const provider = {
    getProcessesWithWorkCenters: async () => [
      { id: "proc-1", workCenters: ["wc1", "wc2"] },
    ],
    getActiveWorkCenters: async () => [{ id: "wc1" }, { id: "wc2" }],
  } as unknown as MasterDataProvider;

  const selector = new WorkCenterSelector(provider, "loc1");
  await selector.initialize();
  selector.setFiniteContext(
    makeContext({
      capacityByWorkCenter: new Map([
        [
          "wc1",
          {
            workCenter: { id: "wc1" },
            windows: [{ start: now, end: windowsEnd }],
            reservations: [],
          },
        ],
        [
          "wc2",
          {
            workCenter: { id: "wc2" },
            windows: [{ start: now, end: windowsEnd }],
            reservations: [],
          },
        ],
      ]),
    })
  );

  // Both ops inherit wc1 from the SAME make method (the reported bug: two
  // identical jobs would previously stack on wc1). Neither has started; each
  // is 4h of labor.
  const opFields = {
    workCenterId: "wc1",
    setupTime: 0,
    laborTime: 4,
    laborUnit: "Total Hours" as const,
    machineTime: 0,
    operationQuantity: 1,
    quantityComplete: 0,
  };
  const ops = [
    makeOp({ id: "op-a", order: 1, ...opFields }),
    makeOp({ id: "op-b", order: 2, ...opFields }),
  ];

  const selections = await selector.selectWorkCentersForOperations(ops, {
    jobDueDate: null,
  });

  const a = selections.get("op-a")?.workCenterId;
  const b = selections.get("op-b")?.workCenterId;
  assert(a && b, "both ops were placed on a work center");
  assert(a !== b, `expected the two ops to spread across centers; both got ${a}`);
  assertEquals(new Set([a, b]), new Set(["wc1", "wc2"]));
});

Deno.test("a started op stays pinned to its work center (no rebalancing)", async () => {
  const now = new Date("2026-01-05T00:00:00.000Z");
  const windowsEnd = new Date("2026-02-05T00:00:00.000Z");
  const provider = {
    getProcessesWithWorkCenters: async () => [
      { id: "proc-1", workCenters: ["wc1", "wc2"] },
    ],
    getActiveWorkCenters: async () => [{ id: "wc1" }, { id: "wc2" }],
  } as unknown as MasterDataProvider;

  const selector = new WorkCenterSelector(provider, "loc1");
  await selector.initialize();
  selector.setFiniteContext(
    makeContext({
      capacityByWorkCenter: new Map([
        [
          "wc1",
          {
            workCenter: { id: "wc1" },
            // wc1 is heavily loaded so an idle wc2 would finish sooner...
            windows: [{ start: now, end: windowsEnd }],
            reservations: [
              { startAt: now, endAt: new Date("2026-01-10T00:00:00.000Z") },
            ],
          },
        ],
        [
          "wc2",
          {
            workCenter: { id: "wc2" },
            windows: [{ start: now, end: windowsEnd }],
            reservations: [],
          },
        ],
      ]),
    })
  );

  // ...but this op is already In Progress on wc1, so it must NOT move to wc2.
  const op = makeOp({
    id: "op-1",
    workCenterId: "wc1",
    status: "In Progress",
  });

  const selections = await selector.selectWorkCentersForOperations([op], {
    jobDueDate: null,
  });
  assertEquals(selections.get("op-1")?.workCenterId, "wc1");
});

// --- pinned (manually scheduled) ops: no frozen window ----------------------

Deno.test("a pinned op is placed like any other and keeps its due date (no frozen window)", async () => {
  const selector = new WorkCenterSelector(
    {} as unknown as MasterDataProvider,
    "loc1"
  );
  selector.setFiniteContext(makeContext());

  // Pinned to 2026-08-11 — under dual dates the pin owns the need-by TARGET,
  // not the placement: forward-ASAP still places the op as early as it can.
  const op = makeOp({
    id: "op-pin",
    workCenterId: "wc1",
    manuallyScheduled: true,
    startDate: null,
    dueDate: "2026-08-11",
    setupTime: 0,
    laborTime: 4,
    laborUnit: "Total Hours",
    machineTime: 0,
    operationQuantity: 1,
    quantityComplete: 0,
  });

  const selections = await selector.selectWorkCentersForOperations([op], {
    jobDueDate: null,
  });
  const selection = selections.get("op-pin");
  assert(
    selection?.placedStart && selection.placedEnd,
    "pinned op gets a real placement"
  );
  // Forward-ASAP from now — NOT the pinned 2026-08-11 window.
  assertEquals(selection.placedStart, "2026-01-05T00:00:00.000Z");
  assertEquals(selection.placedEnd, "2026-01-05T04:00:00.000Z");

  // The placement books real capacity; the pinned span reserves nothing.
  const reservations = selector
    .getPlannedReservations()
    .filter((r) => r.operationId === "op-pin");
  assertEquals(reservations.length, 1);
  assertEquals(reservations[0].startAt.toISOString(), selection.placedStart);
  assertEquals(reservations[0].endAt.toISOString(), selection.placedEnd);

  // Applying the selection records the forecast; the pinned dueDate survives.
  const applied = applyWorkCenterSelections(
    new Map([["op-pin", op]]),
    selections
  ).get("op-pin")!;
  assertEquals(applied.startDate, "2026-01-05");
  assertEquals(applied.projectedCompletionAt, "2026-01-05T04:00:00.000Z");
  assertEquals(applied.dueDate, "2026-08-11");
});
