import { type CalendarWindow, intersectWindows } from "./calendar-utils.ts";
import {
  classifyLatePlacement,
  composeLateConflict,
  composePlacementNote
} from "./conflict-messages.ts";
import {
  businessDayFromMs,
  msToInstantIso,
  toInstantMs
} from "./date-utils.ts";
import {
  calculateDurationBreakdown,
  calculateDurationHours,
  remainingFractions
} from "./duration-calculator.ts";
import type { MasterDataProvider } from "./master-data-provider.ts";
import {
  isEligibleOperator,
  type QualifiedEmployee
} from "./operator-eligibility.ts";
import type { PeopleDayRow } from "./people-utils.ts";
import { clipWindowsToStation } from "./people-utils.ts";
import {
  type AttendedAllocationSuccess,
  allocateAttendedOperation,
  allocateOperation,
  type EligibleMember,
  isConflict,
  type ReservationInterval,
  type ResourceCapacityData
} from "./slot-allocator.ts";
import type {
  JobOperationDependency,
  PlannedReservation,
  ScheduledOperation,
  WorkCenterSelection
} from "./types.ts";

/** The single ability a process requires (resolved via process.requiresAbility). */
export type ProcessRequirement = {
  abilityId: string;
  abilityName: string;
};

/** A qualified employee plus their availability windows (from their shifts). */
export type PoolEmployee = QualifiedEmployee & { windows: CalendarWindow[] };

export {
  isEligibleOperator,
  type QualifiedEmployee
} from "./operator-eligibility.ts";

/**
 * Preloaded finite-capacity data, built by the engine in selectWorkCenters().
 * Reservation arrays are mutated in-run as operations are placed so later
 * operations see earlier placements.
 */
export type FiniteSchedulingContext = {
  capacityByWorkCenter: Map<string, ResourceCapacityData>;
  /** processId -> required ability (only processes with requiresAbility = true) */
  requirementByProcess: Map<string, ProcessRequirement>;
  employeesByAbility: Map<string, PoolEmployee[]>;
  /**
   * Named-person bookings (Employee-kind reservations) keyed by employee id,
   * spanning ALL abilities — one person can never be in two places at once.
   * Mutated in-run as attended segments are committed.
   */
  reservationsByEmployee: Map<string, ReservationInterval[]>;
  dependencies: JobOperationDependency[];
  /** epoch-ms */
  now: number;
  horizonDays: number;
  /**
   * End of the precomputed availability windows (work-center + shift). The
   * per-op walk must not search past this: beyond it there are no windows,
   * so a feasible far-future placement would read as a spurious
   * "no capacity" conflict. epoch-ms.
   */
  windowsEnd: number;
  /**
   * Manning board: workCenterId -> local dateKey (YYYY-MM-DD) -> employeeIds
   * assigned at that station that day. Absent people are already removed.
   * Empty when no people assignments exist in the horizon (blank board =>
   * behavior identical to pre-people scheduling).
   */
  peopleByWorkCenter: Map<string, Map<string, string[]>>;
  /**
   * Manning board, inverted: employeeId -> dateKey -> the stations the person
   * is assigned at that day. A manned person is committed to those stations, so
   * the any-qualified fallback relay excludes them from every OTHER station on
   * those days (interpretation B — the board is a commitment, not a soft
   * preference). Empty when the board is blank => fallback behaves exactly as
   * before.
   */
  assignmentsByEmployee: Map<string, Map<string, Set<string>>>;
  /**
   * Per-location "Require staffing to schedule" policy (`location.requiresStaffing`).
   * When true the finite scheduler places work ONLY where an operator is manned:
   * the gated any-qualified floater fallback is disabled, and the ungated
   * machine-only fallback is disabled EXCEPT on lights-out (`alwaysOn`) stations.
   * An op with no manned coverage becomes an unschedulable placeholder. False =
   * the fallbacks stay, i.e. the pre-setting behavior (byte-identical).
   */
  requiresStaffing: boolean;
  /**
   * Split days: employeeId -> dateKey -> that day's station rows in order.
   * Each station's clip gets only its budgeted share of the person's day; a
   * sole whole-shift row keeps the full day (pre-split behavior).
   */
  peopleBudgets: Map<string, Map<string, PeopleDayRow[]>>;
  /**
   * Availability windows (post-absence, post-overtime-extension) for ALL
   * known people — qualified and people-assigned alike. employeesByAbility
   * members reference the same window arrays.
   */
  windowsByEmployee: Map<string, CalendarWindow[]>;
  /**
   * IANA time zone of the job's location. Lateness is judged and message
   * dates are worded in the FACTORY's calendar day, not UTC's.
   */
  timeZone: string;
  /**
   * Operation ids that already have ≥1 production event — their setup is done,
   * so remaining-work netting reserves labor/machine (scaled by remaining
   * quantity) but no setup time. Absent id => not started.
   */
  operationsWithEvents: Set<string>;
};

/**
 * The manning-board view of one work center: each member's assigned dates
 * there. Null when the station has no people in the horizon (default
 * machine-only / any-qualified behavior).
 */
function peopleInfoForWorkCenter(
  ctx: FiniteSchedulingContext,
  workCenterId: string
): { memberPeopleDates: Map<string, Set<string>> } | null {
  const byDate = ctx.peopleByWorkCenter.get(workCenterId);
  if (!byDate || byDate.size === 0) return null;
  const memberPeopleDates = new Map<string, Set<string>>();
  for (const [dateKey, employeeIds] of byDate) {
    for (const employeeId of employeeIds) {
      let dates = memberPeopleDates.get(employeeId);
      if (!dates) {
        dates = new Set();
        memberPeopleDates.set(employeeId, dates);
      }
      dates.add(dateKey);
    }
  }
  return { memberPeopleDates };
}

/**
 * Deterministic topological placement order (Kahn's algorithm) over the
 * operation dependency edges: a predecessor is always placed before the
 * operations that depend on it, so its in-run reservation is visible to its
 * successors' walks. The ready set is ordered by jobOperation."order" then id,
 * so identical inputs always yield the identical order (the nervousness control
 * that makes whole-location regeneration safe). A dependency cycle (should
 * never occur) degrades to that same deterministic order for the leftover ops.
 */
function topologicalPlacementOrder<T extends { id: string; order?: number }>(
  operations: T[],
  dependencies: JobOperationDependency[]
): T[] {
  const opById = new Map(operations.map((o) => [o.id, o]));
  const inDegree = new Map<string, number>();
  for (const o of operations) inDegree.set(o.id, 0);
  const dependents = new Map<string, string[]>(); // dependsOnId -> [operationId]
  const seenEdge = new Set<string>();
  for (const d of dependencies) {
    if (!opById.has(d.operationId) || !opById.has(d.dependsOnId)) continue;
    const key = `${d.operationId}<-${d.dependsOnId}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    inDegree.set(d.operationId, (inDegree.get(d.operationId) ?? 0) + 1);
    const list = dependents.get(d.dependsOnId) ?? [];
    list.push(d.operationId);
    dependents.set(d.dependsOnId, list);
  }

  const cmp = (a: T, b: T) => {
    const ao = a.order ?? 0;
    const bo = b.order ?? 0;
    if (ao !== bo) return ao - bo;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };

  // Ready set (in-degree 0), kept sorted; take the smallest each round.
  const ready = operations
    .filter((o) => (inDegree.get(o.id) ?? 0) === 0)
    .sort(cmp);
  const result: T[] = [];
  while (ready.length > 0) {
    const op = ready.shift()!;
    result.push(op);
    for (const depId of dependents.get(op.id) ?? []) {
      const deg = (inDegree.get(depId) ?? 0) - 1;
      inDegree.set(depId, deg);
      if (deg === 0) {
        const depOp = opById.get(depId);
        if (!depOp) continue;
        // Binary-insert into the sorted ready set.
        let lo = 0;
        let hi = ready.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cmp(ready[mid]!, depOp) <= 0) lo = mid + 1;
          else hi = mid;
        }
        ready.splice(lo, 0, depOp);
      }
    }
  }

  if (result.length < operations.length) {
    const done = new Set(result.map((o) => o.id));
    for (const o of [...operations].sort(cmp)) {
      if (!done.has(o.id)) result.push(o);
    }
  }

  return result;
}

/**
 * Work Center Selector — placement. Two finite resources gate every
 * placement: the work center itself (capacity 1 — one operation at a time,
 * held for the op's full span) and, for ability-gated operations, PEOPLE —
 * named qualified persons booked only for the ATTENDED window (setup +
 * labor) at the start, relaying across shifts; the unattended remainder
 * runs lights-out on calendar time.
 */
export class WorkCenterSelector {
  private provider: MasterDataProvider;
  private locationId: string;
  private workCentersByProcess: Map<string, string[]> = new Map();
  private activeWorkCenters: Set<string> = new Set();
  private finiteContext: FiniteSchedulingContext | null = null;
  private plannedReservations: PlannedReservation[] = [];

  constructor(provider: MasterDataProvider, locationId: string) {
    this.provider = provider;
    this.locationId = locationId;
  }

  setFiniteContext(context: FiniteSchedulingContext): void {
    this.finiteContext = context;
  }

  getPlannedReservations(): PlannedReservation[] {
    return this.plannedReservations;
  }

  /** Candidate work centers across a set of processes (for capacity preload). */
  getAllCandidateWorkCenterIds(processIds: (string | null)[]): string[] {
    const ids = new Set<string>();
    for (const processId of processIds) {
      if (!processId) continue;
      for (const wcId of this.getWorkCentersForProcess(processId)) {
        ids.add(wcId);
      }
    }
    return Array.from(ids);
  }

  /**
   * Initialize work center data
   */
  async initialize(): Promise<void> {
    // Get processes and their work centers
    const processes = await this.provider.getProcessesWithWorkCenters();

    // Get active work centers at this location
    const workCenters = await this.provider.getActiveWorkCenters(
      this.locationId
    );

    // Build set of active work center IDs
    for (const wc of workCenters) {
      if (wc.id) {
        this.activeWorkCenters.add(wc.id);
      }
    }

    // Build process to work centers map (only include active work centers at this location)
    for (const process of processes) {
      if (process.workCenters && process.id) {
        const validWorkCenters = process.workCenters.filter((wcId) =>
          this.activeWorkCenters.has(wcId)
        );
        this.workCentersByProcess.set(process.id, validWorkCenters);
      }
    }
  }

  /**
   * Get work centers that support a given process
   */
  getWorkCentersForProcess(processId: string): string[] {
    return this.workCentersByProcess.get(processId) ?? [];
  }

  /**
   * Check if a work center is valid (exists and is active at this location)
   */
  isValidWorkCenter(workCenterId: string): boolean {
    return this.activeWorkCenters.has(workCenterId);
  }

  /**
   * Select work centers for multiple operations: for each operation, walk
   * forward to the first span where the work center is free (capacity 1)
   * AND (when the process requires an ability) the attended window can be
   * staffed by qualified, un-booked people (relay across shifts; pause when
   * nobody is free). Pick the candidate work center with the earliest
   * finish — a busy machine yields a later finish, so this load-balances
   * across candidates naturally (tie → least reserved time, preferring the
   * emptier machine). Conflicts surface on the selection, never fail hard.
   */
  selectWorkCentersForOperations(
    operations: ScheduledOperation[],
    options?: {
      /**
       * The JOB's due date ("YYYY-MM-DD") — the real deadline. Placements
       * finishing after it are flagged as late. The backward-computed
       * per-op need-by dates (`op.dueDate`) are NOT used for lateness:
       * they are demand-anchored TARGETS — outputs of the need-by pass,
       * never placement constraints (spec 2026-08-15). When null/omitted
       * (job has no due date), placements are never flagged as late.
       */
      jobDueDate?: string | null;
    }
  ): Map<string, WorkCenterSelection> {
    const jobDueDate = options?.jobDueDate ?? null;
    const ctx = this.finiteContext;
    if (!ctx) {
      throw new Error(
        "WorkCenterSelector: finite context not set — call setFiniteContext() first"
      );
    }

    const selections = new Map<string, WorkCenterSelection>();
    this.plannedReservations = [];

    const depsByOperation = new Map<string, string[]>();
    for (const d of ctx.dependencies) {
      const list = depsByOperation.get(d.operationId) ?? [];
      list.push(d.dependsOnId);
      depsByOperation.set(d.operationId, list);
    }

    const placedEndByOperation = new Map<string, number>();

    // For inherited-delay conflict messages: name the predecessor that made
    // an operation start late
    const descriptionById = new Map<string, string>();
    for (const o of operations) {
      if (o.description) descriptionById.set(o.id, o.description);
    }

    // Deterministic topological placement order: each predecessor is placed
    // before its dependents, so in-run reservations from predecessors are
    // visible to their successors' walks. Pinned and outside ops participate in
    // the same order.
    const sorted = topologicalPlacementOrder(operations, ctx.dependencies);

    for (const op of sorted) {
      if (op.operationType === "Outside Processing") {
        // Outside operations consume no internal capacity, but they DO
        // occupy calendar time: place them after their predecessors so
        // successors wait for the outsourced turnaround and the timeline
        // shows real dates instead of the coarse backward-pass ones.
        if (op.manuallyScheduled) {
          // Keep pinned dates; successors still chain after the pinned end
          if (op.dueDate) {
            placedEndByOperation.set(
              op.id,
              toInstantMs(op.dueDate) + 24 * 3_600_000
            );
          }
          continue;
        }

        let earliestMs = ctx.now;
        if (op.startDate) {
          earliestMs = Math.max(earliestMs, toInstantMs(op.startDate));
        }
        for (const depId of depsByOperation.get(op.id) ?? []) {
          const depEnd = placedEndByOperation.get(depId);
          if (depEnd !== undefined) {
            earliestMs = Math.max(earliestMs, depEnd);
          }
        }
        const start = earliestMs;
        const outsideDurationHours =
          op.durationHours ??
          calculateDurationHours({ ...op, priority: op.priority ?? undefined });
        // Calendar time, not working time — the supplier's clock runs 24/7
        const end = earliestMs + outsideDurationHours * 3_600_000;
        placedEndByOperation.set(op.id, end);

        let outsideConflict: string | null = null;
        const outsideEndDate = businessDayFromMs(end, ctx.timeZone);
        if (jobDueDate && outsideEndDate > jobDueDate) {
          outsideConflict = composeLateConflict(outsideEndDate, jobDueDate, {
            kind: "outside-processing"
          });
        }

        selections.set(op.id, {
          workCenterId: op.workCenterId ?? null,
          priority: 0,
          placedStart: msToInstantIso(start),
          placedEnd: msToInstantIso(end),
          conflict: outsideConflict
        });
        continue;
      }

      // Manually scheduled (pinned) ops flow through NORMAL placement: a pin
      // owns the need-by TARGET (op.dueDate, taken as-is by the backward
      // pass), not the placement — the schedule is the projection. The old
      // frozen-window reservation of the pinned span was removed with the
      // dual-dates split (spec 2026-08-15).

      if (!op.processId) {
        selections.set(op.id, {
          workCenterId: null,
          priority: 0,
          error: "No process ID provided"
        });
        continue;
      }

      // Sticky work centers: an op that has already STARTED stays on its machine
      // — setups/fixtures/operators physically live there, so a replan must not
      // bounce it. A not-yet-started op balances across the whole process pool
      // even if it carries a make-method's default work center, so the
      // earliest-finish selection below can spread two identical jobs across
      // equivalent machines instead of stacking them on one center. If the
      // process has no mapped centers, fall back to the op's assigned center so
      // a misconfigured pool (or one deactivated since assignment) never strands
      // the op.
      const started =
        op.status === "In Progress" ||
        op.status === "Paused" ||
        (op.quantityComplete ?? 0) > 0;
      const assignedWorkCenter =
        op.workCenterId && ctx.capacityByWorkCenter.has(op.workCenterId)
          ? op.workCenterId
          : null;
      const pool = this.getWorkCentersForProcess(op.processId);
      const candidates =
        started && assignedWorkCenter
          ? [assignedWorkCenter]
          : pool.length > 0
            ? pool
            : assignedWorkCenter
              ? [assignedWorkCenter]
              : [];
      if (candidates.length === 0) {
        selections.set(op.id, {
          workCenterId: null,
          priority: 0,
          error: `No work centers found for process ${op.processId}`
        });
        continue;
      }

      // Earliest feasible start: forward-ASAP from now, never before an in-run
      // predecessor placement. No backward-pass floor — the projected finish
      // must carry slack to be an overdue early-warning. NEVER floor placement
      // on op.dueDate — targets are outputs, not constraints (spec 2026-08-15).
      // Track whether a predecessor's placement is the binding bound — a late
      // placement that never waited for its own resources inherited the delay
      // from that dep.
      let earliestMs = ctx.now;
      let dominantDepId: string | null = null;
      for (const depId of depsByOperation.get(op.id) ?? []) {
        const depEnd = placedEndByOperation.get(depId);
        if (depEnd !== undefined && depEnd > earliestMs) {
          earliestMs = depEnd;
          dominantDepId = depId;
        }
      }
      const earliestStart = earliestMs;
      // Cap at the precomputed windows: walking past them finds nothing and
      // would flag feasible far-future ops as capacity conflicts
      const horizonEnd = Math.min(
        earliestMs + ctx.horizonDays * 24 * 3_600_000,
        ctx.windowsEnd
      );

      // The operation's requirement comes from its PROCESS (single ability)
      const requirement = ctx.requirementByProcess.get(op.processId) ?? null;
      const members = requirement
        ? this.buildEligibleMembers(requirement, earliestStart, ctx)
        : null;

      // Remaining-work netting: a started operation reserves only the work
      // left. Labor + machine scale by remaining quantity; setup is done once
      // any production event exists. A fully-complete op nets to 0 hours and is
      // filtered from the reservation set in persistChanges (endAt > startAt).
      const { setup: setupFrac, work: workFrac } = remainingFractions(
        op,
        ctx.operationsWithEvents.has(op.id)
      );
      const breakdown = calculateDurationBreakdown({
        ...op,
        priority: op.priority ?? undefined
      });
      const setupHours = breakdown.setupHours * setupFrac;
      const laborHours = breakdown.laborHours * workFrac;
      const machineHours = breakdown.machineHours * workFrac;
      // Total = setup + max(labor, machine) since labor and machine overlap
      const durationHours = setupHours + Math.max(laborHours, machineHours);
      // Hands-on window (setup + labor); the rest of the span runs lights-out
      const attendedHours = Math.min(setupHours + laborHours, durationHours);
      // Split components for people team mode (labor parallelizes across the
      // present people; setup and machine time don't)
      const teamComponents = { setupHours, laborHours, machineHours };

      let best: {
        wcId: string;
        slot: AttendedAllocationSuccess;
        reservedMs: number;
        capacity: ResourceCapacityData;
        staffed: boolean;
      } | null = null;
      let firstConflict: string | null = null;

      if (requirement && members && members.length === 0 && attendedHours > 0) {
        // Nobody qualified can ever free up — named conflict, no walk needed
        firstConflict = `No qualified operator for ${requirement.abilityName}`;
      } else {
        for (const wcId of candidates) {
          const capacity = ctx.capacityByWorkCenter.get(wcId);
          if (!capacity) continue;

          const people = peopleInfoForWorkCenter(ctx, wcId);

          let slot: AttendedAllocationSuccess;
          let staffed = false;
          if (requirement) {
            // Pass 1 (soft prefer): when the station has people, the assigned
            // QUALIFIED people work the op TOGETHER on their assigned days
            // (team mode: everyone booked on the same op, labor parallelized
            // across whoever is present; setup/machine not). A pass-1 miss is
            // not a conflict; pass 2 is today's any-qualified relay behavior.
            let result: AttendedAllocationSuccess | null = null;
            if (people) {
              const peopleQualified = (members ?? []).flatMap((m) => {
                const dates = people.memberPeopleDates.get(m.employeeId);
                if (!dates) return [];
                const windows = intersectWindows(
                  clipWindowsToStation(
                    m.windows,
                    wcId,
                    dates,
                    ctx.peopleBudgets.get(m.employeeId),
                    ctx.timeZone
                  ),
                  // A person can't run a closed machine — clip to its hours
                  capacity.windows
                );
                return windows.length > 0
                  ? [{ employeeId: m.employeeId, windows }]
                  : [];
              });
              if (peopleQualified.length > 0) {
                const pass1 = allocateAttendedOperation({
                  attendedHours,
                  totalHours: durationHours,
                  earliestStart,
                  horizonEnd,
                  capacity,
                  members: peopleQualified,
                  busyByEmployee: ctx.reservationsByEmployee,
                  timeZone: ctx.timeZone,
                  team: teamComponents
                });
                if (!isConflict(pass1)) {
                  result = pass1;
                  staffed = true;
                }
              }
            }
            if (!result && ctx.requiresStaffing) {
              // Require-staffing policy: gated work runs ONLY where a qualified
              // operator is manned. No floater fallback — if pass 1 (assigned +
              // qualified) couldn't staff this station, the op doesn't place here;
              // it stays a conflict and, if no candidate is staffed, an
              // unschedulable placeholder on the Forecast.
              if (!firstConflict) {
                firstConflict = `No operator assigned for ${requirement.abilityName}`;
              }
              continue;
            }
            if (!result) {
              // Any-qualified relay (the soft fallback): clip each member to the
              // machine's hours so nobody is booked while the machine is closed.
              // The manning board is a COMMITMENT, not a soft preference: a person
              // you have assigned ANYWHERE in the horizon is spoken for, so the
              // fallback may only draw on true FLOATERS — qualified people with no
              // board presence at all. This keeps a manned person from being
              // pulled to a station they were never assigned to, AND stops the op
              // from being shoved onto the unmanned days (nights/weekends) a
              // per-date clip would leave open — if no floater can cover it the op
              // honestly conflicts and surfaces on the Forecast as unschedulable.
              // Blank board => every qualified person is a floater => identical to
              // the pre-people fallback.
              const relayMembers = (members ?? [])
                .filter((m) => !ctx.assignmentsByEmployee.has(m.employeeId))
                .map((m) => ({
                  employeeId: m.employeeId,
                  windows: intersectWindows(m.windows, capacity.windows)
                }));
              const pass2 = allocateAttendedOperation({
                attendedHours,
                totalHours: durationHours,
                earliestStart,
                horizonEnd,
                capacity,
                members: relayMembers,
                busyByEmployee: ctx.reservationsByEmployee,
                timeZone: ctx.timeZone
              });
              if (isConflict(pass2)) {
                if (!firstConflict) {
                  firstConflict = pass2.conflict;
                }
                continue;
              }
              result = pass2;
            }
            slot = result;
          } else {
            // Ungated op: a staffed station is MANNED — the present people work the op
            // together (team mode: labor parallelized across whoever is
            // present, setup/machine not), machine holding the full span.
            // Falls back to machine-only (soft) when the people can't cover
            // it; an unassigned station is machine-only exactly as before.
            let result: AttendedAllocationSuccess | null = null;
            if (people && attendedHours > 0) {
              const peopleMembers: EligibleMember[] = [];
              for (const [employeeId, dates] of people.memberPeopleDates) {
                const windows = intersectWindows(
                  clipWindowsToStation(
                    ctx.windowsByEmployee.get(employeeId) ?? [],
                    wcId,
                    dates,
                    ctx.peopleBudgets.get(employeeId),
                    ctx.timeZone
                  ),
                  // A person can't run a closed machine — clip to its hours
                  capacity.windows
                );
                if (windows.length > 0) {
                  peopleMembers.push({ employeeId, windows });
                }
              }
              if (peopleMembers.length > 0) {
                const manned = allocateAttendedOperation({
                  attendedHours,
                  totalHours: durationHours,
                  earliestStart,
                  horizonEnd,
                  capacity,
                  members: peopleMembers,
                  busyByEmployee: ctx.reservationsByEmployee,
                  timeZone: ctx.timeZone,
                  team: teamComponents
                });
                if (!isConflict(manned)) {
                  result = manned;
                  staffed = true;
                }
              }
            }
            // Require-staffing policy: an unstaffed station runs NOTHING unless
            // it is lights-out (`alwaysOn`) — a station configured to run
            // unattended is exempt, so genuine lights-out machining still
            // schedules. Otherwise, with no manned coverage the op stays a
            // conflict and becomes an unschedulable placeholder.
            const lightsOut = capacity.workCenter.alwaysOn === true;
            if (!result && ctx.requiresStaffing && !lightsOut) {
              if (!firstConflict) {
                firstConflict = "No operator assigned";
              }
              continue;
            }
            if (!result) {
              const machineOnly = allocateOperation({
                durationHours,
                earliestStart,
                horizonEnd,
                capacity,
                timeZone: ctx.timeZone
              });
              if (isConflict(machineOnly)) {
                if (!firstConflict) {
                  firstConflict = machineOnly.conflict;
                }
                continue;
              }
              // Normalize the machine-only result to the attended shape
              result = {
                start: machineOnly.start,
                attendedEnd: machineOnly.end,
                end: machineOnly.end,
                segments: [],
                wait: machineOnly.wait
              };
            }
            slot = result;
          }

          const reservedMs = capacity.reservations.reduce(
            (sum, r) => sum + (r.endAt - r.startAt),
            0
          );

          // Earliest finish wins (a busy machine finishes later, so this
          // load-balances across equivalent centers). On a finish tie, prefer
          // the op's CURRENT work center — a method default or a manual move
          // stays put when it is no worse — then the least-reserved center.
          let better: boolean;
          if (!best) {
            better = true;
          } else if (slot.end !== best.slot.end) {
            better = slot.end < best.slot.end;
          } else {
            const isCurrent = wcId === op.workCenterId;
            const bestIsCurrent = best.wcId === op.workCenterId;
            better =
              isCurrent !== bestIsCurrent
                ? isCurrent
                : reservedMs < best.reservedMs;
          }
          if (better) {
            best = { wcId, slot, reservedMs, capacity, staffed };
          }
        }
      }

      if (best) {
        const { wcId, slot, capacity } = best;

        // Why does this op start when it does? The allocator attributed the
        // wait to the binding resource (machine queue vs operator pool) on
        // the chosen candidate's walk. Classified once; feeds the
        // always-stored placement note AND the late-only conflict message.
        const waitedMs = slot.start - earliestMs;
        const cause = classifyLatePlacement({
          waitedMs,
          wait: slot.wait,
          dominantDep: dominantDepId
            ? { description: descriptionById.get(dominantDepId) ?? null }
            : null,
          staffed: best.staffed
        });

        // Commit in-run so subsequent operations see this placement
        capacity.reservations.push({ startAt: slot.start, endAt: slot.end });
        this.plannedReservations.push({
          resourceKind: "WorkCenter",
          resourceId: wcId,
          operationId: op.id,
          startAt: slot.start,
          endAt: slot.end,
          earliestStartAt: earliestStart,
          scheduleNote: composePlacementNote(cause, waitedMs),
          workHours: durationHours
        });
        // Book the named people for their attended segments — in-run (so no
        // later op double-books them, on ANY ability) and persisted
        for (const segment of slot.segments) {
          const list = ctx.reservationsByEmployee.get(segment.employeeId) ?? [];
          list.push({ startAt: segment.startAt, endAt: segment.endAt });
          ctx.reservationsByEmployee.set(segment.employeeId, list);
          this.plannedReservations.push({
            resourceKind: "Employee",
            resourceId: segment.employeeId,
            operationId: op.id,
            startAt: segment.startAt,
            endAt: segment.endAt,
            workHours: (segment.endAt - segment.startAt) / 3_600_000
          });
        }
        placedEndByOperation.set(op.id, slot.end);

        // Late vs the JOB due date => surface as a conflict naming the cause
        let conflict: string | null = null;
        const placedEndDate = businessDayFromMs(slot.end, ctx.timeZone);
        if (jobDueDate && placedEndDate > jobDueDate) {
          conflict = composeLateConflict(placedEndDate, jobDueDate, cause);
        }

        selections.set(op.id, {
          workCenterId: wcId,
          priority: 0,
          placedStart: msToInstantIso(slot.start),
          placedEnd: msToInstantIso(slot.end),
          conflict
        });
      } else {
        // Every candidate conflicted (machine, skill, or shift coverage):
        // keep the least-reserved candidate so the op still has a work
        // center, and surface the cause
        let fallbackWc: string | null = null;
        let leastReserved = Infinity;
        for (const wcId of candidates) {
          const capacity = ctx.capacityByWorkCenter.get(wcId);
          if (!capacity) continue;
          const reservedMs = capacity.reservations.reduce(
            (sum, r) => sum + (r.endAt - r.startAt),
            0
          );
          if (reservedMs < leastReserved) {
            leastReserved = reservedMs;
            fallbackWc = wcId;
          }
        }
        const conflictReason = firstConflict ?? "No feasible capacity slot";

        // Emit a non-binding PLACEHOLDER reservation so the Forecast shows this
        // unplaceable op instead of the job silently ending after its last
        // placeable op. Pinned at the earliest it could START (after
        // predecessors) for its work-content duration in calendar time — a
        // marker of "where it would run once the conflict is resolved", never a
        // real booking. Deliberately NOT pushed into capacity.reservations, and
        // flagged isPlaceholder so getLiveReservations excludes it — it must not
        // hold the machine against other jobs. Chaining placedEndByOperation
        // still makes successors wait for it (they can't run before it does).
        if (durationHours > 0 && fallbackWc) {
          const placeholderEnd = earliestMs + durationHours * 3_600_000;
          this.plannedReservations.push({
            resourceKind: "WorkCenter",
            resourceId: fallbackWc,
            operationId: op.id,
            startAt: earliestStart,
            endAt: placeholderEnd,
            earliestStartAt: earliestStart,
            scheduleNote: conflictReason,
            workHours: durationHours,
            isPlaceholder: true
          });
          placedEndByOperation.set(op.id, placeholderEnd);
        }

        selections.set(op.id, {
          workCenterId: fallbackWc ?? op.workCenterId ?? null,
          priority: 0,
          conflict: conflictReason
        });
      }
    }

    return selections;
  }

  /**
   * Qualified people for the requirement, eligibility-checked as of the
   * operation's start (active, training complete, not expired). Their
   * cross-ability bookings live in ctx.reservationsByEmployee.
   */
  private buildEligibleMembers(
    requirement: ProcessRequirement,
    earliestStart: number,
    ctx: FiniteSchedulingContext
  ): EligibleMember[] {
    const employees = ctx.employeesByAbility.get(requirement.abilityId) ?? [];
    return employees
      .filter((e) => isEligibleOperator(e, earliestStart, ctx.timeZone))
      .map((e) => ({ employeeId: e.employeeId, windows: e.windows }));
  }
}

export {
  applyWorkCenterSelections,
  hasPreassignedWorkCenter
} from "./apply-work-center-selections.ts";
