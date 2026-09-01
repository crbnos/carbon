import {
  fromAbsolute,
  getDayOfWeek,
  parseAbsolute,
  parseDate,
  toCalendarDate
} from "@internationalized/date";
import { it } from "vitest";

/**
 * Determinism proof for the finite placement engine.
 *
 * The determinism-critical logic — forward-ASAP placement, topological order,
 * allocation, and tie-breaks — is a PURE function of an injected
 * `FiniteSchedulingContext`: `WorkCenterSelector.selectWorkCentersForOperations`
 * touches no DB. So these tests drive the selector directly with a rich
 * in-memory fixture (following `work-center-selector.test.ts`), scaled up to
 * ~20 jobs / ~120 operations across six work centers spanning the three rungs
 * of the machine-availability ladder, ability-gated processes, a qualified
 * operator pool, and a manning board.
 *
 * The selector MUTATES `capacity.reservations` and `ctx.reservationsByEmployee`
 * as it places operations, so every helper below returns FRESH arrays/maps on
 * each call — a second run must never share state with the first.
 *
 * The dual-dates guards (spec 2026-08-15) also run here: the backward need-by
 * pass (`computeNeedByDates`, pure) runs over the SAME fixture inputs as
 * placement, so the suite can pin the hard rule both ways — targets never
 * influence placement, and capacity never influences targets.
 */

import {
  type CalendarShiftRow,
  type CalendarWindow,
  expandCalendar,
  STOCK_WEEK_SHIFTS
} from "./calendar-utils.ts";
import { DependencyGraphImpl } from "./dependency-manager.ts";
import type {
  ActiveWorkCenter,
  MasterDataProvider,
  ProcessWorkCenters
} from "./master-data-provider.ts";
import { calendarAdapters, computeNeedByDates } from "./need-by-calculator.ts";
import type { PeopleDayRow } from "./people-utils.ts";
import { buildAssignmentsByEmployee } from "./people-utils.ts";
import type { ResourceCapacityData } from "./slot-allocator.ts";
import { assert, assertEquals } from "./test-helpers.ts";
import type {
  JobOperationDependency,
  PlannedReservation,
  ScheduledOperation
} from "./types.ts";
import {
  type FiniteSchedulingContext,
  type PoolEmployee,
  type ProcessRequirement,
  WorkCenterSelector
} from "./work-center-selector.ts";

const utc = (iso: string) => parseAbsolute(iso, "UTC").toDate().getTime();
const iso = (ms: number) => fromAbsolute(ms, "UTC").toAbsoluteString();

// A fixed clock on a Monday so weekday windows line up predictably.
const NOW_ISO = "2026-01-05T00:00:00.000Z";
const WINDOWS_END_ISO = "2026-08-01T00:00:00.000Z";

const WORK_CENTERS = [
  "wc-always-1", // rung 1: alwaysOn (one continuous lights-out window)
  "wc-always-2", // rung 1: alwaysOn
  "wc-rung3-a", // rung 3: stock Mon-Fri 08:00-16:00
  "wc-rung3-b", // rung 3
  "wc-rung2-a", // rung 2: location shifts 06:00-14:00 + 14:00-22:00 weekdays
  "wc-rung2-b" // rung 2
] as const;

// The rung-3 work center used by the weekend assertion.
const RUNG3_WORK_CENTER = "wc-rung3-a";

// Two weekday location shifts (availability-ladder rung 2).
const RUNG2_SHIFTS: CalendarShiftRow[] = [1, 2, 3, 4, 5].flatMap(
  (dayOfWeek) => [
    { dayOfWeek, startTime: "06:00", endTime: "14:00" },
    { dayOfWeek, startTime: "14:00", endTime: "22:00" }
  ]
);

// op index within a job -> process. pA/pB are ability-gated; pC/pD/pE ungated.
const PROCESS_BY_OP_INDEX = ["pA", "pB", "pC", "pD", "pE", "pC"] as const;

const JOB_COUNT = 20;
const OPS_PER_JOB = 6;

function continuousWindow(start: number, end: number): CalendarWindow[] {
  return [{ start, end }];
}

function capacity(id: string, windows: CalendarWindow[]): ResourceCapacityData {
  return { workCenter: { id }, windows, reservations: [] };
}

/** Weekday YYYY-MM-DD keys in [startKey, endKey], computed purely in UTC. */
function weekdayKeysUTC(startKey: string, endKey: string): string[] {
  const keys: string[] = [];
  let cursor = parseDate(startKey);
  const end = parseDate(endKey);
  while (cursor.compare(end) <= 0) {
    const dow = getDayOfWeek(cursor, "en-US"); // 0=Sun..6=Sat
    if (dow >= 1 && dow <= 5) keys.push(cursor.toString());
    cursor = cursor.add({ days: 1 });
  }
  return keys;
}

/**
 * Tiny provider fixture: only the two methods `initialize()` calls are real
 * (to build `workCentersByProcess` for the handful of ops that need work-center
 * SELECTION). Every other method is unused by `selectWorkCentersForOperations`.
 */
function makeProvider(): MasterDataProvider {
  return {
    getProcessesWithWorkCenters: (): Promise<ProcessWorkCenters[]> =>
      Promise.resolve([
        { id: "pA", workCenters: ["wc-rung3-a", "wc-rung3-b"] },
        { id: "pB", workCenters: ["wc-rung2-a", "wc-rung2-b"] },
        { id: "pC", workCenters: ["wc-always-1", "wc-always-2"] },
        { id: "pD", workCenters: ["wc-rung3-a", "wc-always-1"] },
        { id: "pE", workCenters: ["wc-rung2-a", "wc-always-2"] }
      ]),
    getActiveWorkCenters: (locationId: string): Promise<ActiveWorkCenter[]> =>
      Promise.resolve(WORK_CENTERS.map((id) => ({ id, locationId })))
  } as unknown as MasterDataProvider;
}

function makeDependencies(): JobOperationDependency[] {
  const deps: JobOperationDependency[] = [];
  for (let j = 0; j < JOB_COUNT; j++) {
    for (let k = 1; k < OPS_PER_JOB; k++) {
      deps.push({
        operationId: `op-${j}-${k}`,
        dependsOnId: `op-${j}-${k - 1}`,
        jobId: `job-${j}`
      });
    }
  }
  return deps;
}

function makeOperations(): ScheduledOperation[] {
  const ops: ScheduledOperation[] = [];
  for (let j = 0; j < JOB_COUNT; j++) {
    for (let k = 0; k < OPS_PER_JOB; k++) {
      const processId = PROCESS_BY_OP_INDEX[k] ?? "pC";
      // A handful of ops carry no work center -> they exercise SELECTION via
      // the provider's process->work-center map. The rest are sticky.
      const isSelectionOp = j < 6 && k === OPS_PER_JOB - 1;
      const workCenterId = isSelectionOp
        ? null
        : (WORK_CENTERS[(j + k) % WORK_CENTERS.length] ?? "wc-always-1");
      const setupTime = 0.5 + (k % 2) * 0.5;
      const laborTime = 1 + (k % 3);
      const machineTime = 0.5 + (k % 2);
      ops.push({
        id: `op-${j}-${k}`,
        jobId: `job-${j}`,
        processId,
        workCenterId,
        order: k,
        setupTime,
        setupUnit: "Total Hours",
        laborTime,
        laborUnit: "Total Hours",
        machineTime,
        machineUnit: "Total Hours",
        operationQuantity: 10,
        quantityComplete: 0,
        startDate: null,
        dueDate: null,
        priority: 99,
        durationHours: setupTime + Math.max(laborTime, machineTime),
        durationDays: 1,
        hasConflict: false,
        conflictReason: null,
        status: "Ready"
      });
    }
  }
  return ops;
}

/**
 * Calendar windows per work center — the ONE fixture calendar, consumed by
 * finite placement (as capacity windows) AND by the backward need-by pass
 * (via `calendarAdapters`), mirroring the engine's shared windows fetch.
 * Fresh Date objects on every call — runs must never share state.
 */
function makeWorkCenterWindows(): Map<string, CalendarWindow[]> {
  const now = utc(NOW_ISO);
  const windowsEnd = utc(WINDOWS_END_ISO);
  return new Map<string, CalendarWindow[]>([
    ["wc-always-1", continuousWindow(now, windowsEnd)],
    ["wc-always-2", continuousWindow(now, windowsEnd)],
    ["wc-rung3-a", expandCalendar(STOCK_WEEK_SHIFTS, now, windowsEnd, "UTC")],
    ["wc-rung3-b", expandCalendar(STOCK_WEEK_SHIFTS, now, windowsEnd, "UTC")],
    ["wc-rung2-a", expandCalendar(RUNG2_SHIFTS, now, windowsEnd, "UTC")],
    ["wc-rung2-b", expandCalendar(RUNG2_SHIFTS, now, windowsEnd, "UTC")]
  ]);
}

function makeContext(): FiniteSchedulingContext {
  const now = utc(NOW_ISO);
  const windowsEnd = utc(WINDOWS_END_ISO);
  const empWindows = () =>
    expandCalendar(STOCK_WEEK_SHIFTS, now, windowsEnd, "UTC");
  const manningDates = weekdayKeysUTC("2026-01-05", "2026-01-30");

  const capacityByWorkCenter = new Map<string, ResourceCapacityData>(
    [...makeWorkCenterWindows()].map(([id, windows]) => [
      id,
      capacity(id, windows)
    ])
  );

  const employeesByAbility = new Map<string, PoolEmployee[]>([
    [
      "ability-A",
      [
        { employeeId: "emp1", expiresAt: null, windows: empWindows() },
        { employeeId: "emp2", expiresAt: null, windows: empWindows() }
      ]
    ],
    [
      "ability-B",
      [
        { employeeId: "emp3", expiresAt: null, windows: empWindows() },
        { employeeId: "emp4", expiresAt: null, windows: empWindows() }
      ]
    ]
  ]);

  const requirementByProcess = new Map<string, ProcessRequirement>([
    ["pA", { abilityId: "ability-A", abilityName: "Welding" }],
    ["pB", { abilityId: "ability-B", abilityName: "Machining" }]
  ]);

  const windowsByEmployee = new Map<string, CalendarWindow[]>([
    ["emp1", empWindows()],
    ["emp2", empWindows()],
    ["emp3", empWindows()],
    ["emp4", empWindows()]
  ]);

  // Manning board: emp1 mans wc-always-1 every January weekday. This exercises
  // both the gated (team pass 1) and ungated (manned) people placement paths.
  const peopleByWorkCenter = new Map<string, Map<string, string[]>>([
    [
      "wc-always-1",
      new Map(manningDates.map((d): [string, string[]] => [d, ["emp1"]]))
    ]
  ]);
  const peopleBudgets = new Map<string, Map<string, PeopleDayRow[]>>([
    [
      "emp1",
      new Map(
        manningDates.map((d): [string, PeopleDayRow[]] => [
          d,
          [{ workCenterId: "wc-always-1", hours: null }]
        ])
      )
    ]
  ]);

  return {
    capacityByWorkCenter,
    requirementByProcess,
    employeesByAbility,
    reservationsByEmployee: new Map(),
    dependencies: makeDependencies(),
    now,
    horizonDays: 365,
    windowsEnd,
    peopleByWorkCenter,
    assignmentsByEmployee: buildAssignmentsByEmployee(peopleByWorkCenter),
    requiresStaffing: false,
    peopleBudgets,
    windowsByEmployee,
    timeZone: "UTC",
    operationsWithEvents: new Set<string>()
  };
}

async function placeAll(
  overrides: {
    operations?: ScheduledOperation[];
    jobDueDate?: string | null;
    /** Applied to a FRESH context before placement (e.g. add a reservation). */
    mutateContext?: (ctx: FiniteSchedulingContext) => void;
  } = {}
): Promise<PlannedReservation[]> {
  const selector = new WorkCenterSelector(makeProvider(), "loc1");
  await selector.initialize();
  const ctx = makeContext();
  overrides.mutateContext?.(ctx);
  selector.setFiniteContext(ctx);
  await selector.selectWorkCentersForOperations(
    overrides.operations ?? makeOperations(),
    { jobDueDate: overrides.jobDueDate ?? null }
  );
  return selector.getPlannedReservations();
}

// --- comparison helpers ------------------------------------------------------

type NormalizedReservation = {
  resourceKind: string;
  resourceId: string;
  operationId: string;
  startAt: string;
  endAt: string;
};

function sortKey(r: NormalizedReservation): string {
  return `${r.operationId}|${r.resourceKind}|${r.resourceId}|${r.startAt}|${r.endAt}`;
}

/** Reservations as a stably-sorted multiset of their placement-defining fields. */
function normalize(
  reservations: PlannedReservation[]
): NormalizedReservation[] {
  return reservations
    .map((r) => ({
      resourceKind: r.resourceKind,
      resourceId: r.resourceId,
      operationId: r.operationId,
      startAt: iso(r.startAt),
      endAt: iso(r.endAt)
    }))
    .sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
}

const OP_TO_JOB = new Map(
  makeOperations().map((o): [string, string] => [o.id, o.jobId])
);

/** Each job's projected completion = the latest reservation end over its ops. */
function projectedCompletion(
  reservations: PlannedReservation[]
): [string, string][] {
  const maxByJob = new Map<string, string>();
  for (const r of reservations) {
    const jobId = OP_TO_JOB.get(r.operationId);
    if (!jobId) continue;
    const isoStr = iso(r.endAt);
    const current = maxByJob.get(jobId);
    if (!current || isoStr > current) maxByJob.set(jobId, isoStr);
  }
  return [...maxByJob.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
  );
}

// --- tests -------------------------------------------------------------------

it("two runs with identical inputs produce identical placements", async () => {
  const first = await placeAll();
  const second = await placeAll();

  assert(
    first.length > 0,
    "expected the selector to place at least one reservation"
  );

  // Placements are identical as a multiset of (resource, operation, start, end).
  assertEquals(normalize(first), normalize(second));

  // Every job's projected completion is identical between the two runs...
  assertEquals(projectedCompletion(first), projectedCompletion(second));
  // ...and every job placed at least one operation.
  assertEquals(projectedCompletion(first).length, JOB_COUNT);
});

// --- dual-dates guards (spec 2026-08-15) -------------------------------------
//
// The backward need-by pass is a pure function of the same fixture inputs
// placement runs on, so both directions of the hard rule are provable here
// without a DB: targets never influence placement (test below), and capacity
// never influences targets (stability test).

// A Friday well inside the fixture windows (which end 2026-08-01).
const JOB_DUE_DATE = "2026-03-06";

/**
 * Run the backward need-by pass over the SAME fixture world placement uses:
 * one walk per job (as the engine does), calendars derived from the context's
 * capacity WINDOWS via `calendarAdapters` — mirroring the engine's shared
 * windows fetch. Note the input surface: windows, operations, dependencies,
 * and the job due date. Reservations are capacity, not calendar, and must
 * never enter (the stability test pins that).
 */
function computeFixtureNeedBys(
  ctx: FiniteSchedulingContext,
  jobDueDate: string | null,
  operations: ScheduledOperation[] = makeOperations()
): Map<string, string | null> {
  const windowsByWorkCenter = new Map<string, CalendarWindow[]>(
    [...ctx.capacityByWorkCenter].map(([id, cap]) => [id, cap.windows])
  );
  const locationWindows = expandCalendar(
    STOCK_WEEK_SHIFTS,
    utc(NOW_ISO),
    utc(WINDOWS_END_ISO),
    "UTC"
  );
  const { calendarHoursPerDay, workingDayTest } = calendarAdapters(
    windowsByWorkCenter,
    locationWindows,
    "UTC"
  );

  const dependencies = makeDependencies();
  const result = new Map<string, string | null>();
  for (let j = 0; j < JOB_COUNT; j++) {
    const jobId = `job-${j}`;
    const jobOps = operations.filter((op) => op.jobId === jobId);
    const jobDeps = dependencies.filter((d) => d.jobId === jobId);
    const graph = new DependencyGraphImpl(
      jobOps.map((op) => ({
        id: op.id,
        jobId: op.jobId,
        processId: op.processId
      })),
      jobDeps
    );
    const needBys = computeNeedByDates({
      operations: jobOps,
      graph,
      jobDueDate,
      calendarHoursPerDay,
      workingDayTest
    });
    for (const [operationId, needBy] of needBys) {
      result.set(operationId, needBy);
    }
  }
  return result;
}

/** Byte-comparable serialization of a need-by map (sorted entries, JSON). */
function serializeNeedBys(needBys: Map<string, string | null>): string {
  return JSON.stringify(
    [...needBys.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
    )
  );
}

it("targets never influence placement: identical with and without need-by dates", async () => {
  // World A — the demand world: a real job due date, the backward pass run
  // over the fixture calendars, and its need-by targets stamped onto
  // `op.dueDate` exactly as a post-regen snapshot would carry them.
  const needBys = computeFixtureNeedBys(makeContext(), JOB_DUE_DATE);

  // Guard against a vacuous pass: every op gets a REAL computed target...
  assertEquals(needBys.size, JOB_COUNT * OPS_PER_JOB);
  for (const [operationId, needBy] of needBys) {
    assert(
      needBy !== null && /^\d{4}-\d{2}-\d{2}$/.test(needBy),
      `expected a computed need-by for ${operationId}, got ${needBy}`
    );
  }
  // ...and each job's leaf op anchors on the job due date.
  for (let j = 0; j < JOB_COUNT; j++) {
    assertEquals(needBys.get(`op-${j}-${OPS_PER_JOB - 1}`), JOB_DUE_DATE);
  }
  const withTargets = makeOperations().map((op) => ({
    ...op,
    dueDate: needBys.get(op.id) ?? null
  }));

  // World B — the need-by map forced empty via the documented bypass: a null
  // job due date maps every operation to null (nothing is "due").
  const bypassed = computeFixtureNeedBys(makeContext(), null);
  assertEquals(bypassed.size, JOB_COUNT * OPS_PER_JOB);
  for (const [operationId, needBy] of bypassed) {
    assertEquals(needBy, null, `bypassed need-by for ${operationId}`);
  }
  const withoutTargets = makeOperations().map((op) => ({
    ...op,
    dueDate: bypassed.get(op.id) ?? null
  }));

  const placedWith = await placeAll({
    operations: withTargets,
    jobDueDate: JOB_DUE_DATE
  });
  const placedWithout = await placeAll({
    operations: withoutTargets,
    jobDueDate: null
  });

  assert(placedWith.length > 0, "expected placements in the demand world");
  // The spec's hard rule (2026-08-15 dual dates): targets are OUTPUTS of the
  // backward pass, never placement constraints — the placement multiset is
  // identical whether or not any due-date world exists at all.
  assertEquals(normalize(placedWith), normalize(placedWithout));
});

it("need-by maps are stable and capacity-invariant while placements move", async () => {
  // Two identical worlds produce byte-identical need-by maps.
  const first = serializeNeedBys(
    computeFixtureNeedBys(makeContext(), JOB_DUE_DATE)
  );
  const second = serializeNeedBys(
    computeFixtureNeedBys(makeContext(), JOB_DUE_DATE)
  );
  assertEquals(first, second);

  // Capacity-only change: a week-long foreign reservation occupying
  // wc-always-1 from the clock start — a reservation/downtime input, NOT a
  // due-date, routing, lead-time, or calendar-window input.
  const blockWcAlways1 = (ctx: FiniteSchedulingContext) => {
    const cap = ctx.capacityByWorkCenter.get("wc-always-1");
    assert(cap, "fixture is missing wc-always-1 capacity");
    cap.reservations.push({
      startAt: utc("2026-01-05T00:00:00.000Z"),
      endAt: utc("2026-01-12T00:00:00.000Z"),
      readableJobId: "J-FOREIGN"
    });
  };

  const baseline = await placeAll();
  const displaced = await placeAll({ mutateContext: blockWcAlways1 });
  assert(baseline.length > 0 && displaced.length > 0);
  // The reservation really moved the forward placements...
  assert(
    JSON.stringify(normalize(baseline)) !==
      JSON.stringify(normalize(displaced)),
    "expected the added reservation to move at least one placement"
  );

  // ...while the need-by pass over the SAME mutated world stays
  // byte-identical: targets are demand-anchored (due date + routing + lead
  // times + calendars); reservations never enter the backward pass. If
  // capacity data is ever threaded into the need-by inputs, this fails.
  const mutatedCtx = makeContext();
  blockWcAlways1(mutatedCtx);
  const afterCapacityChange = serializeNeedBys(
    computeFixtureNeedBys(mutatedCtx, JOB_DUE_DATE)
  );
  assertEquals(afterCapacityChange, first);
});

it("no placement falls on a weekend for a rung-3 work center", async () => {
  const reservations = (await placeAll()).filter(
    (r) => r.resourceKind === "WorkCenter" && r.resourceId === RUNG3_WORK_CENTER
  );

  assert(
    reservations.length > 0,
    `expected placements on rung-3 work center ${RUNG3_WORK_CENTER}`
  );

  for (const r of reservations) {
    const startDow = getDayOfWeek(
      toCalendarDate(fromAbsolute(r.startAt, "UTC")),
      "en-US"
    );
    assert(
      startDow >= 1 && startDow <= 5,
      `reservation for ${r.operationId} starts on weekend day ${startDow} (${iso(r.startAt)})`
    );
  }
});
