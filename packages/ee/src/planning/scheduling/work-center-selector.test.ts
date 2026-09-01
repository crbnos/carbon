import { parseAbsolute } from "@internationalized/date";
import { it } from "vitest";
import type { MasterDataProvider } from "./master-data-provider.ts";
import {
  buildAssignmentsByEmployee,
  buildPeopleByWorkCenter
} from "./people-utils.ts";
import { assert, assertEquals } from "./test-helpers.ts";
import type { ScheduledOperation } from "./types.ts";
import {
  applyWorkCenterSelections,
  type FiniteSchedulingContext,
  hasPreassignedWorkCenter,
  WorkCenterSelector
} from "./work-center-selector.ts";

const utc = (iso: string) => parseAbsolute(iso, "UTC").toDate().getTime();

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
    ...overrides
  };
}

it("hasPreassignedWorkCenter is true only for non-empty ids", () => {
  assertEquals(hasPreassignedWorkCenter("wc-1"), true);
  assertEquals(hasPreassignedWorkCenter(null), false);
  assertEquals(hasPreassignedWorkCenter(undefined), false);
  assertEquals(hasPreassignedWorkCenter(""), false);
});

it("applyWorkCenterSelections does not overwrite pre-assigned work centers", () => {
  const ops = new Map<string, ScheduledOperation>([
    ["op-pre", makeOp({ id: "op-pre", workCenterId: "user-wc" })],
    ["op-new", makeOp({ id: "op-new", workCenterId: null })]
  ]);
  const selections = new Map([
    ["op-pre", { workCenterId: "auto-wc", priority: 0 }],
    ["op-new", { workCenterId: "auto-wc", priority: 0 }]
  ]);

  const result = applyWorkCenterSelections(ops, selections);

  assertEquals(result.get("op-pre")?.workCenterId, "user-wc");
  assertEquals(result.get("op-new")?.workCenterId, "auto-wc");
});

it("applyWorkCenterSelections leaves ops untouched when selection has no WC", () => {
  const ops = new Map<string, ScheduledOperation>([
    ["op-1", makeOp({ id: "op-1", workCenterId: null })]
  ]);
  const selections = new Map([
    ["op-1", { workCenterId: null, priority: 0, error: "no process" }]
  ]);

  const result = applyWorkCenterSelections(ops, selections);
  assertEquals(result.get("op-1")?.workCenterId, null);
});

// --- remaining-work netting at the selector level ---------------------------

function makeContext(
  overrides: Partial<FiniteSchedulingContext> = {}
): FiniteSchedulingContext {
  const now = utc("2026-01-05T00:00:00.000Z"); // Monday
  const windowsEnd = utc("2026-02-05T00:00:00.000Z");
  return {
    capacityByWorkCenter: new Map([
      [
        "wc1",
        {
          workCenter: { id: "wc1" },
          // one continuous window (alwaysOn-equivalent) so hours == wall clock
          windows: [{ start: now, end: windowsEnd }],
          reservations: []
        }
      ]
    ]),
    requirementByProcess: new Map(),
    employeesByAbility: new Map(),
    reservationsByEmployee: new Map(),
    dependencies: [],
    now,
    horizonDays: 365,
    windowsEnd,
    peopleByWorkCenter: new Map(),
    assignmentsByEmployee: new Map(),
    requiresStaffing: false,
    peopleBudgets: new Map(),
    windowsByEmployee: new Map(),
    timeZone: "UTC",
    operationsWithEvents: new Set<string>(),
    ...overrides
  };
}

it("a half-complete op with a production event books half the hours", async () => {
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
    quantityComplete: 5
  });

  const selections = await selector.selectWorkCentersForOperations([op], {
    jobDueDate: null
  });

  const selection = selections.get("op-1");
  assert(selection?.placedStart && selection.placedEnd);
  const spanMs = utc(selection.placedEnd) - utc(selection.placedStart);
  assertEquals(spanMs, 2 * 60 * 60 * 1000); // 2h, not the full 4h

  const reservation = selector
    .getPlannedReservations()
    .find((r) => r.operationId === "op-1" && r.resourceKind === "WorkCenter");
  assertEquals(reservation?.workHours, 2);
});

it("an untouched op books the full standard hours", async () => {
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
    quantityComplete: 0
  });

  const selections = await selector.selectWorkCentersForOperations([op], {
    jobDueDate: null
  });
  const selection = selections.get("op-1");
  assert(selection?.placedStart && selection.placedEnd);
  const spanMs = utc(selection.placedEnd) - utc(selection.placedStart);
  assertEquals(spanMs, 4 * 60 * 60 * 1000); // full 4h
});

// --- load balancing across equivalent work centers --------------------------

it("two identical not-started ops spread across equivalent work centers", async () => {
  const now = utc("2026-01-05T00:00:00.000Z"); // Monday
  const windowsEnd = utc("2026-02-05T00:00:00.000Z");

  // proc-1 runs on wc1 AND wc2 (interchangeable); both active at the location.
  const provider = {
    getProcessesWithWorkCenters: async () => [
      { id: "proc-1", workCenters: ["wc1", "wc2"] }
    ],
    getActiveWorkCenters: async () => [{ id: "wc1" }, { id: "wc2" }]
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
            reservations: []
          }
        ],
        [
          "wc2",
          {
            workCenter: { id: "wc2" },
            windows: [{ start: now, end: windowsEnd }],
            reservations: []
          }
        ]
      ])
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
    quantityComplete: 0
  };
  const ops = [
    makeOp({ id: "op-a", order: 1, ...opFields }),
    makeOp({ id: "op-b", order: 2, ...opFields })
  ];

  const selections = await selector.selectWorkCentersForOperations(ops, {
    jobDueDate: null
  });

  const a = selections.get("op-a")?.workCenterId;
  const b = selections.get("op-b")?.workCenterId;
  assert(a && b, "both ops were placed on a work center");
  assert(
    a !== b,
    `expected the two ops to spread across centers; both got ${a}`
  );
  assertEquals(new Set([a, b]), new Set(["wc1", "wc2"]));
});

it("a started op stays pinned to its work center (no rebalancing)", async () => {
  const now = utc("2026-01-05T00:00:00.000Z");
  const windowsEnd = utc("2026-02-05T00:00:00.000Z");
  const provider = {
    getProcessesWithWorkCenters: async () => [
      { id: "proc-1", workCenters: ["wc1", "wc2"] }
    ],
    getActiveWorkCenters: async () => [{ id: "wc1" }, { id: "wc2" }]
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
              { startAt: now, endAt: utc("2026-01-10T00:00:00.000Z") }
            ]
          }
        ],
        [
          "wc2",
          {
            workCenter: { id: "wc2" },
            windows: [{ start: now, end: windowsEnd }],
            reservations: []
          }
        ]
      ])
    })
  );

  // ...but this op is already In Progress on wc1, so it must NOT move to wc2.
  const op = makeOp({
    id: "op-1",
    workCenterId: "wc1",
    status: "In Progress"
  });

  const selections = await selector.selectWorkCentersForOperations([op], {
    jobDueDate: null
  });
  assertEquals(selections.get("op-1")?.workCenterId, "wc1");
});

// --- pinned (manually scheduled) ops: no frozen window ----------------------

it("a pinned op is placed like any other and keeps its due date (no frozen window)", async () => {
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
    quantityComplete: 0
  });

  const selections = await selector.selectWorkCentersForOperations([op], {
    jobDueDate: null
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
  assertEquals(reservations[0]?.startAt, utc(selection.placedStart));
  assertEquals(reservations[0]?.endAt, utc(selection.placedEnd));

  // Applying the selection records the forecast; the pinned dueDate survives.
  const applied = applyWorkCenterSelections(
    new Map([["op-pin", op]]),
    selections
  ).get("op-pin")!;
  assertEquals(applied.startDate, "2026-01-05");
  assertEquals(applied.projectedCompletionAt, "2026-01-05T04:00:00.000Z");
  assertEquals(applied.dueDate, "2026-08-11");
});

// --- unplaceable ops: non-binding placeholder reservations ------------------

it("an unplaceable gated op emits a non-binding placeholder reservation", async () => {
  const selector = new WorkCenterSelector(
    {} as unknown as MasterDataProvider,
    "loc1"
  );
  // proc-1 requires the Timesaver ability, but NOBODY holds it
  // (employeesByAbility has no ab1 entry) — the op can never be staffed.
  selector.setFiniteContext(
    makeContext({
      requirementByProcess: new Map([
        ["proc-1", { abilityId: "ab1", abilityName: "Timesaver" }]
      ]),
      employeesByAbility: new Map()
    })
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
    operationQuantity: 1,
    quantityComplete: 0
  });

  const selections = await selector.selectWorkCentersForOperations([op], {
    jobDueDate: null
  });

  // Surfaced as a conflict, keeps a fallback work center, NO real placement.
  const selection = selections.get("op-1");
  assert(selection?.conflict?.includes("No qualified operator"));
  assertEquals(selection?.workCenterId, "wc1");
  assertEquals(selection?.placedStart, undefined);
  assertEquals(selection?.placedEnd, undefined);

  // A placeholder reservation is emitted so the Forecast can show the op:
  // pinned at the earliest start, its full work content, flagged.
  const placeholder = selector
    .getPlannedReservations()
    .find((r) => r.operationId === "op-1");
  assert(placeholder, "a placeholder reservation exists");
  assertEquals(placeholder.isPlaceholder, true);
  assertEquals(placeholder.resourceId, "wc1");
  assertEquals(placeholder.startAt, utc("2026-01-05T00:00:00.000Z"));
  assertEquals(placeholder.endAt, utc("2026-01-05T04:00:00.000Z"));
  assertEquals(placeholder.workHours, 4);

  // Crucially it holds NO capacity — the in-run blocking set stays empty so it
  // never pushes other jobs' work out.
  const capacity = selector["finiteContext"]!.capacityByWorkCenter.get("wc1")!;
  assertEquals(capacity.reservations.length, 0);
});

it("a successor waits for an unplaceable predecessor's placeholder", async () => {
  const now = utc("2026-01-05T00:00:00.000Z");
  const windowsEnd = utc("2026-02-05T00:00:00.000Z");

  const selector = new WorkCenterSelector(
    {} as unknown as MasterDataProvider,
    "loc1"
  );
  selector.setFiniteContext(
    makeContext({
      capacityByWorkCenter: new Map([
        [
          "wc1",
          {
            workCenter: { id: "wc1" },
            windows: [{ start: now, end: windowsEnd }],
            reservations: []
          }
        ],
        [
          "wc2",
          {
            workCenter: { id: "wc2" },
            windows: [{ start: now, end: windowsEnd }],
            reservations: []
          }
        ]
      ]),
      // op-1's process is gated with nobody qualified; op-2's is ungated.
      requirementByProcess: new Map([
        ["proc-1", { abilityId: "ab1", abilityName: "Timesaver" }]
      ]),
      employeesByAbility: new Map(),
      dependencies: [
        { jobId: "job-1", operationId: "op-2", dependsOnId: "op-1" }
      ]
    })
  );

  const opUnplaceable = makeOp({
    id: "op-1",
    processId: "proc-1",
    workCenterId: "wc1",
    startDate: null,
    dueDate: null,
    setupTime: 0,
    laborTime: 4,
    laborUnit: "Total Hours",
    machineTime: 0,
    operationQuantity: 1,
    quantityComplete: 0
  });
  const opSuccessor = makeOp({
    id: "op-2",
    processId: "proc-2", // ungated
    workCenterId: "wc2",
    startDate: null,
    dueDate: null,
    setupTime: 0,
    laborTime: 2,
    laborUnit: "Total Hours",
    machineTime: 0,
    operationQuantity: 1,
    quantityComplete: 0
  });

  const selections = await selector.selectWorkCentersForOperations(
    [opUnplaceable, opSuccessor],
    { jobDueDate: null }
  );

  // The successor starts at the placeholder's end (not at `now`) — it can't run
  // before its predecessor does, even though the predecessor is unplaceable.
  const successor = selections.get("op-2");
  assertEquals(successor?.placedStart, "2026-01-05T04:00:00.000Z");
  assertEquals(successor?.placedEnd, "2026-01-05T06:00:00.000Z");
});

// --- manning board is a commitment (interpretation B): the any-qualified ------
// fallback must NOT pull a person off the station they're assigned to that day.

/** A gated op on wc1 with the sole qualified operator manned at `mannedAt`. */
function makeMannedElsewhereContext(mannedAt: string | null) {
  const now = utc("2026-01-05T00:00:00.000Z"); // Monday
  const dayEnd = utc("2026-01-06T00:00:00.000Z");
  // brad is the ONLY person qualified for ab1, available only Jan 5.
  const bradWindows = [{ start: now, end: dayEnd }];
  const board = mannedAt
    ? buildPeopleByWorkCenter([
        {
          workCenterId: mannedAt,
          employeeId: "brad",
          date: "2026-01-05",
          shiftId: null
        }
      ])
    : new Map<string, Map<string, string[]>>();
  return makeContext({
    // wc1 (DMU 350) is open only that one day
    capacityByWorkCenter: new Map([
      [
        "wc1",
        {
          workCenter: { id: "wc1" },
          windows: [{ start: now, end: dayEnd }],
          reservations: []
        }
      ]
    ]),
    requirementByProcess: new Map([
      ["proc-1", { abilityId: "ab1", abilityName: "Weld" }]
    ]),
    employeesByAbility: new Map([
      ["ab1", [{ employeeId: "brad", expiresAt: null, windows: bradWindows }]]
    ]),
    windowsByEmployee: new Map([["brad", bradWindows]]),
    peopleByWorkCenter: board,
    assignmentsByEmployee: buildAssignmentsByEmployee(board),
    requiresStaffing: false
  });
}

async function placeGatedOpOnWc1(ctx: FiniteSchedulingContext) {
  const provider = {
    getProcessesWithWorkCenters: async () => [
      { id: "proc-1", workCenters: ["wc1"] }
    ],
    getActiveWorkCenters: async () => [{ id: "wc1" }]
  } as unknown as MasterDataProvider;
  const selector = new WorkCenterSelector(provider, "loc1");
  await selector.initialize();
  selector.setFiniteContext(ctx);
  const op = makeOp({
    id: "op-1",
    processId: "proc-1",
    workCenterId: "wc1",
    startDate: null,
    dueDate: null,
    setupTime: 0,
    laborTime: 2,
    laborUnit: "Total Hours",
    machineTime: 0,
    operationQuantity: 1,
    quantityComplete: 0
  });
  const selections = await selector.selectWorkCentersForOperations([op], {
    jobDueDate: null
  });
  return { selection: selections.get("op-1"), selector };
}

it("a person on the board is not pulled to another station by the fallback", async () => {
  // brad is manned at wc2 (Timesaver). He is the only welder, so wc1 (DMU 350)
  // would previously grab him via the any-qualified fallback — the reported
  // double-booking. Being on the board makes him spoken for, so wc1's gated op
  // honestly conflicts instead of stealing him.
  const { selection, selector } = await placeGatedOpOnWc1(
    makeMannedElsewhereContext("wc2")
  );

  assert(
    selection?.conflict,
    "the op surfaces a conflict rather than a placement"
  );
  assertEquals(selection?.placedStart, undefined);
  const bradBookings = selector
    .getPlannedReservations()
    .filter((r) => r.resourceKind === "Employee" && r.resourceId === "brad");
  assertEquals(bradBookings.length, 0); // never double-booked onto wc1

  // ...but the op MUST still surface on the Forecast as unschedulable — a
  // non-binding placeholder reservation on the fallback work center, so the
  // board shows "can't be scheduled" instead of the op silently vanishing.
  const placeholder = selector
    .getPlannedReservations()
    .find((r) => r.operationId === "op-1" && r.resourceKind === "WorkCenter");
  assert(placeholder, "an unschedulable placeholder is emitted for the op");
  assertEquals(placeholder.isPlaceholder, true);
  assertEquals(placeholder.resourceId, "wc1");
});

it("a genuinely-unassigned person still floats to another station's fallback", async () => {
  // Same op, but the board is blank: brad is a free floater, so the fallback
  // relay books him on wc1 exactly as before (the fix is scoped to committed
  // people only — blank board is unchanged).
  const { selection, selector } = await placeGatedOpOnWc1(
    makeMannedElsewhereContext(null)
  );

  assertEquals(selection?.conflict ?? null, null);
  assertEquals(selection?.placedStart, "2026-01-05T00:00:00.000Z");
  const bradBookings = selector
    .getPlannedReservations()
    .filter((r) => r.resourceKind === "Employee" && r.resourceId === "brad");
  assertEquals(bradBookings.length, 1); // floater booked on wc1 as before
});

it("a managed person is not shoved onto an unmanned weekend to staff another station", async () => {
  // Regression: a per-DATE commitment clip left the person free on the days they
  // were NOT manned (nights/weekends), so the fallback quietly scheduled the op
  // FAR in the future on one of those days and re-booked the person there — the
  // op then fell outside the current week and read as "missing" on the Forecast.
  // The board is a whole-horizon commitment: a person manned at DMU all week is
  // never a Timesaver floater, so Timesaver's op is an in-window placeholder.
  const now = utc("2026-01-05T00:00:00.000Z"); // Monday
  const windowsEnd = utc("2026-01-12T00:00:00.000Z"); // one week of windows
  const bradWindows = [{ start: now, end: windowsEnd }]; // available all week
  const board = buildPeopleByWorkCenter(
    ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"].map(
      (date) => ({
        workCenterId: "wc-dmu",
        employeeId: "brad",
        date,
        shiftId: null
      })
    )
  );

  const provider = {
    getProcessesWithWorkCenters: async () => [
      { id: "proc-weld", workCenters: ["wc-dmu"] },
      { id: "proc-clean", workCenters: ["wc-ts"] }
    ],
    getActiveWorkCenters: async () => [{ id: "wc-dmu" }, { id: "wc-ts" }]
  } as unknown as MasterDataProvider;
  const selector = new WorkCenterSelector(provider, "loc1");
  await selector.initialize();
  selector.setFiniteContext({
    capacityByWorkCenter: new Map([
      [
        "wc-dmu",
        {
          workCenter: { id: "wc-dmu" },
          windows: [{ start: now, end: windowsEnd }],
          reservations: []
        }
      ],
      [
        "wc-ts",
        {
          workCenter: { id: "wc-ts" },
          windows: [{ start: now, end: windowsEnd }],
          reservations: []
        }
      ]
    ]),
    requirementByProcess: new Map([
      ["proc-weld", { abilityId: "ab-weld", abilityName: "Weld" }],
      ["proc-clean", { abilityId: "ab-clean", abilityName: "Clean" }]
    ]),
    employeesByAbility: new Map([
      [
        "ab-weld",
        [{ employeeId: "brad", expiresAt: null, windows: bradWindows }]
      ],
      [
        "ab-clean",
        [{ employeeId: "brad", expiresAt: null, windows: bradWindows }]
      ]
    ]),
    reservationsByEmployee: new Map(),
    dependencies: [
      { jobId: "j1", operationId: "op-clean", dependsOnId: "op-weld" }
    ],
    now,
    horizonDays: 365,
    windowsEnd,
    peopleByWorkCenter: board,
    assignmentsByEmployee: buildAssignmentsByEmployee(board),
    requiresStaffing: false,
    peopleBudgets: new Map(),
    windowsByEmployee: new Map([["brad", bradWindows]]),
    timeZone: "UTC",
    operationsWithEvents: new Set<string>()
  });

  const base = {
    jobId: "j1",
    setupTime: 0,
    laborUnit: "Total Hours" as const,
    machineTime: 0,
    operationQuantity: 1,
    quantityComplete: 0,
    startDate: null,
    dueDate: null,
    hasConflict: false,
    conflictReason: null,
    durationDays: 1
  };
  const selections = await selector.selectWorkCentersForOperations(
    [
      makeOp({
        ...base,
        id: "op-weld",
        processId: "proc-weld",
        workCenterId: "wc-dmu",
        order: 1,
        laborTime: 4,
        durationHours: 4
      }),
      makeOp({
        ...base,
        id: "op-clean",
        processId: "proc-clean",
        workCenterId: "wc-ts",
        order: 2,
        laborTime: 2,
        durationHours: 2
      })
    ],
    { jobDueDate: null }
  );

  // Weld places on Brad's manned station; Clean CANNOT (Brad is spoken for).
  assertEquals(selections.get("op-weld")?.workCenterId, "wc-dmu");
  assert(selections.get("op-clean")?.conflict, "Clean op surfaces a conflict");

  const cleanReservations = selector
    .getPlannedReservations()
    .filter((r) => r.operationId === "op-clean");
  // A placeholder exists (op is visible on the Forecast as unschedulable)...
  const placeholder = cleanReservations.find(
    (r) => r.resourceKind === "WorkCenter" && r.isPlaceholder
  );
  assert(placeholder, "Clean op emits an unschedulable placeholder");
  // ...pinned in-window (right after Weld), NOT shoved to the weekend...
  assert(
    placeholder.startAt < utc("2026-01-10T00:00:00.000Z"),
    `placeholder must stay in-window, got ${placeholder.startAt}`
  );
  // ...and Brad is NEVER booked onto Timesaver.
  assertEquals(
    cleanReservations.filter((r) => r.resourceKind === "Employee").length,
    0
  );
});

// --- "Require staffing to schedule" (per-location policy) --------------------

/** A gated op on wc1 whose only qualified operator is an UNMANNED floater. */
function makeStaffingCtx(requiresStaffing: boolean, overrides = {}) {
  const now = utc("2026-01-05T00:00:00.000Z");
  const windowsEnd = utc("2026-02-05T00:00:00.000Z");
  const carolWindows = [{ start: now, end: windowsEnd }];
  return makeContext({
    requiresStaffing,
    requirementByProcess: new Map([
      ["proc-1", { abilityId: "ab1", abilityName: "Weld" }]
    ]),
    employeesByAbility: new Map([
      ["ab1", [{ employeeId: "carol", expiresAt: null, windows: carolWindows }]]
    ]),
    windowsByEmployee: new Map([["carol", carolWindows]]),
    // carol is a floater (not on the board), and nobody is manned at wc1
    peopleByWorkCenter: new Map(),
    assignmentsByEmployee: new Map(),
    ...overrides
  });
}

async function placeGatedStaffing(requiresStaffing: boolean) {
  const provider = {
    getProcessesWithWorkCenters: async () => [
      { id: "proc-1", workCenters: ["wc1"] }
    ],
    getActiveWorkCenters: async () => [{ id: "wc1" }]
  } as unknown as MasterDataProvider;
  const selector = new WorkCenterSelector(provider, "loc1");
  await selector.initialize();
  selector.setFiniteContext(makeStaffingCtx(requiresStaffing));
  const op = makeOp({
    id: "op-1",
    processId: "proc-1",
    workCenterId: "wc1",
    startDate: null,
    dueDate: null,
    setupTime: 0,
    laborTime: 2,
    laborUnit: "Total Hours",
    machineTime: 0,
    operationQuantity: 1,
    quantityComplete: 0
  });
  const selections = await selector.selectWorkCentersForOperations([op], {
    jobDueDate: null
  });
  return { selection: selections.get("op-1"), selector };
}

it("requiresStaffing OFF: a gated op still uses an unmanned floater (unchanged)", async () => {
  const { selection, selector } = await placeGatedStaffing(false);
  assertEquals(selection?.conflict ?? null, null);
  const carolBooked = selector
    .getPlannedReservations()
    .some((r) => r.resourceKind === "Employee" && r.resourceId === "carol");
  assert(carolBooked, "the floater staffs the op when the policy is off");
});

it("requiresStaffing ON: a gated op is NOT scheduled on an unmanned floater", async () => {
  const { selection, selector } = await placeGatedStaffing(true);
  assert(selection?.conflict, "the op conflicts — no manned operator");
  assertEquals(selection?.placedStart, undefined);
  const carolBooked = selector
    .getPlannedReservations()
    .some((r) => r.resourceKind === "Employee" && r.resourceId === "carol");
  assertEquals(carolBooked, false); // floater is never auto-assigned under the policy
  const placeholder = selector
    .getPlannedReservations()
    .find((r) => r.operationId === "op-1" && r.resourceKind === "WorkCenter");
  assert(
    placeholder?.isPlaceholder,
    "op surfaces as an unschedulable placeholder"
  );
});

async function placeUngatedStaffing(alwaysOn: boolean) {
  const now = utc("2026-01-05T00:00:00.000Z");
  const windowsEnd = utc("2026-02-05T00:00:00.000Z");
  const selector = new WorkCenterSelector(
    {} as unknown as MasterDataProvider,
    "loc1"
  );
  // Ungated op, sticky on wc1; nobody manned; requiresStaffing ON.
  selector.setFiniteContext(
    makeContext({
      requiresStaffing: true,
      capacityByWorkCenter: new Map([
        [
          "wc1",
          {
            workCenter: { id: "wc1", alwaysOn },
            windows: [{ start: now, end: windowsEnd }],
            reservations: []
          }
        ]
      ])
    })
  );
  const op = makeOp({
    id: "op-1",
    workCenterId: "wc1",
    startDate: null,
    dueDate: null,
    setupTime: 0,
    laborTime: 2,
    laborUnit: "Total Hours",
    machineTime: 0,
    operationQuantity: 1,
    quantityComplete: 0
  });
  const selections = await selector.selectWorkCentersForOperations([op], {
    jobDueDate: null
  });
  return selections.get("op-1");
}

it("requiresStaffing ON: an ungated op on an UNSTAFFED, non-lights-out station is unschedulable", async () => {
  const selection = await placeUngatedStaffing(false);
  assert(
    selection?.conflict,
    "unstaffed non-alwaysOn station schedules nothing"
  );
  assertEquals(selection?.placedStart, undefined);
});

it("requiresStaffing ON: a lights-out (alwaysOn) station still runs unattended", async () => {
  const selection = await placeUngatedStaffing(true);
  assertEquals(selection?.conflict ?? null, null);
  assert(
    selection?.placedStart,
    "lights-out machining is exempt and still schedules"
  );
});
