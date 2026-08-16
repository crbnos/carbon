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
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  type CalendarShiftRow,
  type CalendarWindow,
  expandCalendar,
  STOCK_WEEK_SHIFTS,
} from "./calendar-utils.ts";
import type {
  ActiveWorkCenter,
  MasterDataProvider,
  ProcessWorkCenters,
} from "./master-data-provider.ts";
import type { PeopleDayRow } from "./people-utils.ts";
import type { ResourceCapacityData } from "./slot-allocator.ts";
import type {
  JobOperationDependency,
  PlannedReservation,
  ScheduledOperation,
} from "./types.ts";
import {
  type FiniteSchedulingContext,
  type PoolEmployee,
  type ProcessRequirement,
  WorkCenterSelector,
} from "./work-center-selector.ts";

// A fixed clock on a Monday so weekday windows line up predictably.
const NOW_ISO = "2026-01-05T00:00:00.000Z";
const WINDOWS_END_ISO = "2026-08-01T00:00:00.000Z";

const WORK_CENTERS = [
  "wc-always-1", // rung 1: alwaysOn (one continuous lights-out window)
  "wc-always-2", // rung 1: alwaysOn
  "wc-rung3-a", // rung 3: stock Mon-Fri 08:00-16:00
  "wc-rung3-b", // rung 3
  "wc-rung2-a", // rung 2: location shifts 06:00-14:00 + 14:00-22:00 weekdays
  "wc-rung2-b", // rung 2
] as const;

// The rung-3 work center used by the weekend assertion.
const RUNG3_WORK_CENTER = "wc-rung3-a";

// Two weekday location shifts (availability-ladder rung 2).
const RUNG2_SHIFTS: CalendarShiftRow[] = [1, 2, 3, 4, 5].flatMap((dayOfWeek) => [
  { dayOfWeek, startTime: "06:00", endTime: "14:00" },
  { dayOfWeek, startTime: "14:00", endTime: "22:00" },
]);

// op index within a job -> process. pA/pB are ability-gated; pC/pD/pE ungated.
const PROCESS_BY_OP_INDEX = ["pA", "pB", "pC", "pD", "pE", "pC"] as const;

const JOB_COUNT = 20;
const OPS_PER_JOB = 6;

function continuousWindow(start: Date, end: Date): CalendarWindow[] {
  return [{ start: new Date(start.getTime()), end: new Date(end.getTime()) }];
}

function capacity(id: string, windows: CalendarWindow[]): ResourceCapacityData {
  return { workCenter: { id }, windows, reservations: [] };
}

/** Weekday YYYY-MM-DD keys in [startKey, endKey], computed purely in UTC. */
function weekdayKeysUTC(startKey: string, endKey: string): string[] {
  const keys: string[] = [];
  const end = new Date(`${endKey}T00:00:00.000Z`).getTime();
  for (
    let t = new Date(`${startKey}T00:00:00.000Z`).getTime();
    t <= end;
    t += 24 * 60 * 60 * 1000
  ) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) {
      const month = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      keys.push(`${d.getUTCFullYear()}-${month}-${day}`);
    }
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
        { id: "pE", workCenters: ["wc-rung2-a", "wc-always-2"] },
      ]),
    getActiveWorkCenters: (locationId: string): Promise<ActiveWorkCenter[]> =>
      Promise.resolve(WORK_CENTERS.map((id) => ({ id, locationId }))),
  } as unknown as MasterDataProvider;
}

function makeDependencies(): JobOperationDependency[] {
  const deps: JobOperationDependency[] = [];
  for (let j = 0; j < JOB_COUNT; j++) {
    for (let k = 1; k < OPS_PER_JOB; k++) {
      deps.push({
        operationId: `op-${j}-${k}`,
        dependsOnId: `op-${j}-${k - 1}`,
        jobId: `job-${j}`,
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
        status: "Ready",
      });
    }
  }
  return ops;
}

function makeContext(): FiniteSchedulingContext {
  const now = new Date(NOW_ISO);
  const windowsEnd = new Date(WINDOWS_END_ISO);
  const empWindows = () =>
    expandCalendar(STOCK_WEEK_SHIFTS, now, windowsEnd, "UTC");
  const manningDates = weekdayKeysUTC("2026-01-05", "2026-01-30");

  const capacityByWorkCenter = new Map<string, ResourceCapacityData>([
    ["wc-always-1", capacity("wc-always-1", continuousWindow(now, windowsEnd))],
    ["wc-always-2", capacity("wc-always-2", continuousWindow(now, windowsEnd))],
    [
      "wc-rung3-a",
      capacity("wc-rung3-a", expandCalendar(STOCK_WEEK_SHIFTS, now, windowsEnd, "UTC")),
    ],
    [
      "wc-rung3-b",
      capacity("wc-rung3-b", expandCalendar(STOCK_WEEK_SHIFTS, now, windowsEnd, "UTC")),
    ],
    [
      "wc-rung2-a",
      capacity("wc-rung2-a", expandCalendar(RUNG2_SHIFTS, now, windowsEnd, "UTC")),
    ],
    [
      "wc-rung2-b",
      capacity("wc-rung2-b", expandCalendar(RUNG2_SHIFTS, now, windowsEnd, "UTC")),
    ],
  ]);

  const employeesByAbility = new Map<string, PoolEmployee[]>([
    [
      "ability-A",
      [
        { employeeId: "emp1", expiresAt: null, windows: empWindows() },
        { employeeId: "emp2", expiresAt: null, windows: empWindows() },
      ],
    ],
    [
      "ability-B",
      [
        { employeeId: "emp3", expiresAt: null, windows: empWindows() },
        { employeeId: "emp4", expiresAt: null, windows: empWindows() },
      ],
    ],
  ]);

  const requirementByProcess = new Map<string, ProcessRequirement>([
    ["pA", { abilityId: "ability-A", abilityName: "Welding" }],
    ["pB", { abilityId: "ability-B", abilityName: "Machining" }],
  ]);

  const windowsByEmployee = new Map<string, CalendarWindow[]>([
    ["emp1", empWindows()],
    ["emp2", empWindows()],
    ["emp3", empWindows()],
    ["emp4", empWindows()],
  ]);

  // Manning board: emp1 mans wc-always-1 every January weekday. This exercises
  // both the gated (team pass 1) and ungated (manned) people placement paths.
  const peopleByWorkCenter = new Map<string, Map<string, string[]>>([
    [
      "wc-always-1",
      new Map(manningDates.map((d): [string, string[]] => [d, ["emp1"]])),
    ],
  ]);
  const peopleBudgets = new Map<string, Map<string, PeopleDayRow[]>>([
    [
      "emp1",
      new Map(
        manningDates.map((d): [string, PeopleDayRow[]] => [
          d,
          [{ workCenterId: "wc-always-1", hours: null }],
        ]),
      ),
    ],
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
    peopleBudgets,
    windowsByEmployee,
    timeZone: "UTC",
    operationsWithEvents: new Set<string>(),
  };
}

async function placeAll(): Promise<PlannedReservation[]> {
  const selector = new WorkCenterSelector(makeProvider(), "loc1");
  await selector.initialize();
  selector.setFiniteContext(makeContext());
  await selector.selectWorkCentersForOperations(makeOperations(), {
    jobDueDate: null,
  });
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
function normalize(reservations: PlannedReservation[]): NormalizedReservation[] {
  return reservations
    .map((r) => ({
      resourceKind: r.resourceKind,
      resourceId: r.resourceId,
      operationId: r.operationId,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
    }))
    .sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
}

const OP_TO_JOB = new Map(
  makeOperations().map((o): [string, string] => [o.id, o.jobId]),
);

/** Each job's projected completion = the latest reservation end over its ops. */
function projectedCompletion(
  reservations: PlannedReservation[],
): [string, string][] {
  const maxByJob = new Map<string, string>();
  for (const r of reservations) {
    const jobId = OP_TO_JOB.get(r.operationId);
    if (!jobId) continue;
    const iso = r.endAt.toISOString();
    const current = maxByJob.get(jobId);
    if (!current || iso > current) maxByJob.set(jobId, iso);
  }
  return [...maxByJob.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );
}

// --- tests -------------------------------------------------------------------

Deno.test("two runs with identical inputs produce identical placements", async () => {
  const first = await placeAll();
  const second = await placeAll();

  assert(
    first.length > 0,
    "expected the selector to place at least one reservation",
  );

  // Placements are identical as a multiset of (resource, operation, start, end).
  assertEquals(normalize(first), normalize(second));

  // Every job's projected completion is identical between the two runs...
  assertEquals(projectedCompletion(first), projectedCompletion(second));
  // ...and every job placed at least one operation.
  assertEquals(projectedCompletion(first).length, JOB_COUNT);
});

Deno.test("no placement falls on a weekend for a rung-3 work center", async () => {
  const reservations = (await placeAll()).filter(
    (r) => r.resourceKind === "WorkCenter" && r.resourceId === RUNG3_WORK_CENTER,
  );

  assert(
    reservations.length > 0,
    `expected placements on rung-3 work center ${RUNG3_WORK_CENTER}`,
  );

  for (const r of reservations) {
    const startDow = r.startAt.getUTCDay();
    assert(
      startDow >= 1 && startDow <= 5,
      `reservation for ${r.operationId} starts on weekend day ${startDow} (${r.startAt.toISOString()})`,
    );
  }
});
