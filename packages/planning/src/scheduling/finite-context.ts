import {
  type CalendarShiftRow,
  type CalendarWindow,
  expandCalendar,
  unionWindows
} from "./calendar-utils.ts";
import type { MasterDataProvider } from "./master-data-provider.ts";
import {
  buildAbsencesByEmployee,
  buildAssignmentsByEmployee,
  buildOvertimeByEmployee,
  buildPeopleBudgets,
  buildPeopleByWorkCenter,
  extendWindowsByOvertime,
  subtractAbsences
} from "./people-utils.ts";
import type { ResourceCapacityData } from "./slot-allocator.ts";
import type { JobOperationDependency, ScheduledOperation } from "./types.ts";
import type {
  FiniteSchedulingContext,
  PoolEmployee,
  WorkCenterSelector
} from "./work-center-selector.ts";

export const SCHEDULING_HORIZON_DAYS = 365;

export type AvailabilityWindows = {
  workCenterIds: Set<string>;
  workCenterAvailability: Map<string, CalendarWindow[]>;
  locationDefaultWindows: CalendarWindow[];
  rangeStart: number;
  rangeEnd: number;
};

/**
 * The ONE availability-windows fetch for a scheduling run — work-center windows
 * (selection candidates + current assignments) plus the location's default
 * calendar. The caller (the engine, the quote what-if) memoizes it so the
 * backward need-by pass and buildFiniteContext share the same load instead of
 * reading the provider twice.
 */
export async function loadAvailabilityWindows(args: {
  provider: MasterDataProvider;
  workCenterSelector: WorkCenterSelector | null;
  operations: ScheduledOperation[];
  locationId: string | null;
  now: number;
}): Promise<AvailabilityWindows> {
  const { provider, workCenterSelector, operations, locationId, now } = args;

  const processIds = Array.from(
    new Set(operations.map((op) => op.processId).filter(Boolean))
  ) as string[];

  // Candidates for selection + current assignments (assigned work centers
  // stay in play via the sticky/fallback rules).
  const workCenterIds = new Set(
    workCenterSelector?.getAllCandidateWorkCenterIds(processIds) ?? []
  );
  for (const op of operations) {
    if (op.workCenterId) {
      workCenterIds.add(op.workCenterId);
    }
  }

  const rangeStart = now;
  const rangeEnd = now + (SCHEDULING_HORIZON_DAYS + 7) * 24 * 3_600_000;

  const [workCenterAvailability, locationDefaultWindows] = await Promise.all([
    provider.getWorkCenterAvailability(
      [...workCenterIds],
      rangeStart,
      rangeEnd
    ),
    // People with no employeeShift rows default to the job location's calendar
    // (plant hours), not 24×7 — matching the default machine window so
    // unconfigured labor is non-constraining within plant hours.
    locationId
      ? provider.getLocationCalendarWindows(locationId, rangeStart, rangeEnd)
      : Promise.resolve<CalendarWindow[]>([
          { start: rangeStart, end: rangeEnd }
        ]) // rangeStart/rangeEnd are epoch-ms
  ]);

  return {
    workCenterIds,
    workCenterAvailability,
    locationDefaultWindows,
    rangeStart,
    rangeEnd
  };
}

/**
 * Build the finite-capacity context: live reservations, per-process ability
 * requirements, and qualified-operator availability. Work centers are
 * finite (capacity 1 — one operation at a time, gated by actual
 * reservations); ability-gated operations additionally wait for a
 * qualified person to be on shift and unreserved. Runs just before
 * selection so the rebuilt dependency DAG is final.
 */
export async function buildFiniteContext(args: {
  provider: MasterDataProvider;
  operations: ScheduledOperation[];
  dependencies: JobOperationDependency[];
  availability: AvailabilityWindows;
  locationId: string | null;
  timeZone: string;
  now: number;
  excludeJobIds: string[];
}): Promise<FiniteSchedulingContext> {
  const {
    provider,
    operations,
    dependencies,
    availability,
    locationId,
    timeZone,
    now,
    excludeJobIds
  } = args;

  const processIds = Array.from(
    new Set(operations.map((op) => op.processId).filter(Boolean))
  ) as string[];

  // One shared windows fetch per run (also used by the need-by pass).
  const {
    workCenterIds,
    workCenterAvailability,
    locationDefaultWindows,
    rangeStart,
    rangeEnd
  } = availability;

  const operationIds = operations
    .map((op) => op.id)
    .filter((id): id is string => Boolean(id));

  const [
    liveReservations,
    processRequirements,
    peopleRows,
    absenceRows,
    operationsWithEvents
  ] = await Promise.all([
    provider.getLiveReservations(now, excludeJobIds),
    provider.getProcessRequirements(processIds),
    provider.getPeopleAssignments(rangeStart, rangeEnd, timeZone),
    provider.getPeopleAbsences(rangeStart, rangeEnd, timeZone),
    provider.getOperationsWithEvents(operationIds)
  ]);

  const abilityIds = Array.from(
    new Set(processRequirements.map((r) => r.abilityId))
  );
  const employees = await provider.getQualifiedEmployees(abilityIds);
  // People members at ungated stations need real availability windows too, so
  // shift rows are loaded for the union of qualified + assigned people
  const employeeIds = Array.from(
    new Set([
      ...employees.map((e) => e.employeeId),
      ...peopleRows.map((r) => r.employeeId)
    ])
  );
  const shiftRows = await provider.getEmployeeShiftWindows(employeeIds);

  // Work centers: capacity 1, open per the availability ladder (explicit
  // workCenterShift rows → location shifts → stock Mon–Fri 8h, or one open
  // window for an alwaysOn machine). Reservations GATE placement (one op at a
  // time) and feed attribution. A WC with no resolved windows (e.g. deleted)
  // schedules nothing and surfaces a conflict.
  // Require-staffing policy (per-location) + which stations are lights-out —
  // both feed the selector's fallback gates. One cached read each per batch.
  const [requiresStaffing, alwaysOnWorkCenterIds] = await Promise.all([
    locationId
      ? provider.getLocationRequiresStaffing(locationId)
      : Promise.resolve(false),
    provider.getAlwaysOnWorkCenterIds(Array.from(workCenterIds))
  ]);

  const capacityByWorkCenter = new Map<string, ResourceCapacityData>();
  for (const wcId of workCenterIds) {
    capacityByWorkCenter.set(wcId, {
      workCenter: { id: wcId, alwaysOn: alwaysOnWorkCenterIds.has(wcId) },
      windows: workCenterAvailability.get(wcId) ?? [],
      reservations: liveReservations
        .filter((r) => r.resourceKind === "WorkCenter" && r.resourceId === wcId)
        .map((r) => ({
          startAt: r.startAt,
          endAt: r.endAt,
          readableJobId: r.readableJobId
        }))
    });
  }

  const requirementByProcess = new Map(
    processRequirements.map((r) => [
      r.processId,
      { abilityId: r.abilityId, abilityName: r.abilityName }
    ])
  );

  // Each qualified person's availability = their assigned shifts expanded
  // over the horizon (grouped by timezone, unioned). No shift assignment
  // => always available.
  const shiftPatternsByEmployee = new Map<
    string,
    Map<string, CalendarShiftRow[]>
  >();
  for (const row of shiftRows) {
    let byTz = shiftPatternsByEmployee.get(row.employeeId);
    if (!byTz) {
      byTz = new Map();
      shiftPatternsByEmployee.set(row.employeeId, byTz);
    }
    const list = byTz.get(row.timezone) ?? [];
    list.push({
      dayOfWeek: row.dayOfWeek,
      startTime: row.startTime,
      endTime: row.endTime
    });
    byTz.set(row.timezone, list);
  }
  const windowsByEmployee = new Map<string, CalendarWindow[]>();
  for (const [employeeId, byTz] of shiftPatternsByEmployee) {
    const lists = Array.from(byTz.entries()).map(([tz, shifts]) =>
      expandCalendar(shifts, rangeStart, rangeEnd, tz)
    );
    windowsByEmployee.set(employeeId, unionWindows(lists));
  }

  // People with no shift assignment default to the job location's calendar
  // (plant hours, matching the default machine window) — not 24×7 — so
  // unconfigured labor degrades to non-constraining within plant hours.
  // Materialized here so absences/overtime can adjust it too.
  for (const employeeId of employeeIds) {
    if (!windowsByEmployee.has(employeeId)) {
      windowsByEmployee.set(employeeId, locationDefaultWindows);
    }
  }

  // Absences subtract the person's availability on those dates everywhere —
  // people-preferred and qualified-fallback paths alike
  const absentByEmployee = buildAbsencesByEmployee(absenceRows);
  for (const [employeeId, absentDates] of absentByEmployee) {
    const windows = windowsByEmployee.get(employeeId);
    if (windows) {
      windowsByEmployee.set(
        employeeId,
        subtractAbsences(windows, absentDates, timeZone)
      );
    }
  }

  // An absent person is never that day's people
  const presentPeopleRows = peopleRows.filter(
    (row) => !absentByEmployee.get(row.employeeId)?.has(row.date)
  );
  const peopleByWorkCenter = buildPeopleByWorkCenter(presentPeopleRows);
  // Inverted board (employee -> date -> stations) so the any-qualified
  // fallback can tell a manned person is committed elsewhere that day.
  const assignmentsByEmployee = buildAssignmentsByEmployee(peopleByWorkCenter);

  // Authorized overtime = a longer day: extend the person's last window on
  // each overtime date so the allocator can pack work into the extra hours
  const overtimeByEmployee = buildOvertimeByEmployee(presentPeopleRows);
  for (const [employeeId, overtimeByDate] of overtimeByEmployee) {
    const windows = windowsByEmployee.get(employeeId);
    if (windows) {
      windowsByEmployee.set(
        employeeId,
        extendWindowsByOvertime(windows, overtimeByDate, timeZone)
      );
    }
  }

  // Split days: each station only gets its budgeted share of the person
  const peopleBudgets = buildPeopleBudgets(presentPeopleRows);

  const employeesByAbility = new Map<string, PoolEmployee[]>();
  for (const e of employees) {
    const list = employeesByAbility.get(e.abilityId) ?? [];
    list.push({
      employeeId: e.employeeId,
      expiresAt: e.expiresAt,
      windows: windowsByEmployee.get(e.employeeId) ?? locationDefaultWindows
    });
    employeesByAbility.set(e.abilityId, list);
  }

  // Named-person bookings across ALL abilities, keyed by employee id.
  // Legacy OperatorPool rows are ignored deliberately: they can't be
  // attributed to a person, and they stop existing after each job's next
  // replan (the reactive stale-wave refreshes everything).
  const reservationsByEmployee = new Map<
    string,
    { startAt: number; endAt: number; readableJobId?: string }[]
  >();
  for (const r of liveReservations) {
    if (r.resourceKind !== "Employee") continue;
    const list = reservationsByEmployee.get(r.resourceId) ?? [];
    list.push({
      startAt: r.startAt,
      endAt: r.endAt,
      readableJobId: r.readableJobId
    });
    reservationsByEmployee.set(r.resourceId, list);
  }

  return {
    capacityByWorkCenter,
    requirementByProcess,
    employeesByAbility,
    reservationsByEmployee,
    peopleByWorkCenter,
    assignmentsByEmployee,
    requiresStaffing,
    peopleBudgets,
    windowsByEmployee,
    dependencies,
    now,
    horizonDays: SCHEDULING_HORIZON_DAYS,
    windowsEnd: rangeEnd,
    timeZone,
    operationsWithEvents
  };
}
