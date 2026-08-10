import {
  calculateAttendedHours,
  calculateDurationBreakdown,
  calculateDurationHours,
} from "./duration-calculator.ts";
import {
  classifyLatePlacement,
  composeLateConflict,
  composePlacementNote,
} from "./conflict-messages.ts";
import { businessDay } from "./date-utils.ts";
import type { CalendarWindow } from "./calendar-utils.ts";
import type { CrewDayRow } from "./crew-utils.ts";
import { clipWindowsToStation } from "./crew-utils.ts";
import type { MasterDataProvider } from "./master-data-provider.ts";
import {
  isEligibleOperator,
  type QualifiedEmployee,
} from "./operator-eligibility.ts";
import {
  allocateAttendedOperation,
  allocateOperation,
  type AttendedAllocationSuccess,
  type EligibleMember,
  isConflict,
  type ReservationInterval,
  type ResourceCapacityData,
} from "./slot-allocator.ts";
import type {
  JobOperationDependency,
  PlannedReservation,
  ScheduledOperation,
  WorkCenterSelection,
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
  type QualifiedEmployee,
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
  now: Date;
  horizonDays: number;
  /**
   * End of the precomputed availability windows (work-center + shift). The
   * per-op walk must not search past this: beyond it there are no windows,
   * so a feasible far-future placement would read as a spurious
   * "no capacity" conflict.
   */
  windowsEnd: Date;
  /**
   * Manning board: workCenterId -> local dateKey (YYYY-MM-DD) -> employeeIds
   * crewed at that station that day. Absent people are already removed.
   * Empty when no crew assignments exist in the horizon (blank board =>
   * behavior identical to pre-crew scheduling).
   */
  crewByWorkCenter: Map<string, Map<string, string[]>>;
  /**
   * Split days: employeeId -> dateKey -> that day's station rows in order.
   * Each station's clip gets only its budgeted share of the person's day; a
   * sole whole-shift row keeps the full day (pre-split behavior).
   */
  crewBudgets: Map<string, Map<string, CrewDayRow[]>>;
  /**
   * Availability windows (post-absence, post-overtime-extension) for ALL
   * known people — qualified and crew-assigned alike. employeesByAbility
   * members reference the same window arrays.
   */
  windowsByEmployee: Map<string, CalendarWindow[]>;
  /**
   * IANA time zone of the job's location. Lateness is judged and message
   * dates are worded in the FACTORY's calendar day, not UTC's.
   */
  timeZone: string;
  /**
   * When true (reschedule mode), an operation that already has a work center
   * keeps it — only timing/conflicts are recomputed. Work centers are only
   * (re)selected at initial scheduling, or manually on the operations board.
   */
  stickyWorkCenters: boolean;
};

/**
 * The manning-board view of one work center: each member's crewed dates
 * there. Null when the station has no crew in the horizon (default
 * machine-only / any-qualified behavior).
 */
function crewInfoForWorkCenter(
  ctx: FiniteSchedulingContext,
  workCenterId: string
): { memberCrewDates: Map<string, Set<string>> } | null {
  const byDate = ctx.crewByWorkCenter.get(workCenterId);
  if (!byDate || byDate.size === 0) return null;
  const memberCrewDates = new Map<string, Set<string>>();
  for (const [dateKey, employeeIds] of byDate) {
    for (const employeeId of employeeIds) {
      let dates = memberCrewDates.get(employeeId);
      if (!dates) {
        dates = new Set();
        memberCrewDates.set(employeeId, dates);
      }
      dates.add(dateKey);
    }
  }
  return { memberCrewDates };
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
       * per-op due dates are NOT used for lateness: they round every step
       * up to a whole business day, so they land far earlier than the real
       * requirement and would flag on-time placements. When null/omitted
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

    const placedEndByOperation = new Map<string, Date>();

    // For inherited-delay conflict messages: name the predecessor that made
    // an operation start late
    const descriptionById = new Map<string, string>();
    for (const o of operations) {
      if (o.description) descriptionById.set(o.id, o.description);
    }

    // Sort by start date so DAG order is approximated and in-run reservations
    // from predecessors are visible to successors
    const sorted = [...operations].sort((a, b) => {
      if (!a.startDate && !b.startDate) return 0;
      if (!a.startDate) return 1;
      if (!b.startDate) return -1;
      return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    });

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
              new Date(new Date(op.dueDate).getTime() + 24 * 3_600_000)
            );
          }
          continue;
        }

        let earliestMs = ctx.now.getTime();
        if (op.startDate) {
          earliestMs = Math.max(earliestMs, new Date(op.startDate).getTime());
        }
        for (const depId of depsByOperation.get(op.id) ?? []) {
          const depEnd = placedEndByOperation.get(depId);
          if (depEnd) {
            earliestMs = Math.max(earliestMs, depEnd.getTime());
          }
        }
        const start = new Date(earliestMs);
        const outsideDurationHours =
          op.durationHours ??
          calculateDurationHours({ ...op, priority: op.priority ?? undefined });
        // Calendar time, not working time — the supplier's clock runs 24/7
        const end = new Date(earliestMs + outsideDurationHours * 3_600_000);
        placedEndByOperation.set(op.id, end);

        let outsideConflict: string | null = null;
        const outsideEndDate = businessDay(end.toISOString(), ctx.timeZone);
        if (jobDueDate && outsideEndDate > jobDueDate) {
          outsideConflict = composeLateConflict(outsideEndDate, jobDueDate, {
            kind: "outside-processing",
          });
        }

        selections.set(op.id, {
          workCenterId: op.workCenterId ?? null,
          priority: 0,
          placedStart: start.toISOString(),
          placedEnd: end.toISOString(),
          conflict: outsideConflict,
        });
        continue;
      }

      // Manually scheduled operations keep their pinned dates and work
      // center; reserve their existing window so their capacity still counts
      if (op.manuallyScheduled) {
        if (op.workCenterId && op.startDate && op.dueDate) {
          const startAt = new Date(op.startDate);
          const endAt = new Date(
            new Date(op.dueDate).getTime() + 24 * 3_600_000
          );
          const capacity = ctx.capacityByWorkCenter.get(op.workCenterId);
          if (capacity && endAt.getTime() > startAt.getTime()) {
            capacity.reservations.push({ startAt, endAt });
            this.plannedReservations.push({
              resourceKind: "WorkCenter",
              resourceId: op.workCenterId,
              operationId: op.id,
              startAt,
              endAt,
            });
            placedEndByOperation.set(op.id, endAt);
          }
        }
        selections.set(op.id, {
          workCenterId: op.workCenterId ?? null,
          priority: 0,
        });
        continue;
      }

      if (!op.processId) {
        selections.set(op.id, {
          workCenterId: null,
          priority: 0,
          error: "No process ID provided",
        });
        continue;
      }

      // Sticky work centers: on reschedule, an already-assigned operation
      // stays on its machine (setups/fixtures/operators live there) — the
      // replan only refreshes its timing and conflicts. Falls back to full
      // process candidates when the assigned work center has no capacity
      // data (e.g. it was deactivated since assignment).
      const candidates =
        ctx.stickyWorkCenters &&
        op.workCenterId &&
        ctx.capacityByWorkCenter.has(op.workCenterId)
          ? [op.workCenterId]
          : this.getWorkCentersForProcess(op.processId);
      if (candidates.length === 0) {
        selections.set(op.id, {
          workCenterId: null,
          priority: 0,
          error: `No work centers found for process ${op.processId}`,
        });
        continue;
      }

      // Earliest feasible start: DAG-computed start date, never in the past,
      // never before an in-run predecessor placement. Track whether a
      // predecessor's placement is the binding bound — a late placement that
      // never waited for its own resources inherited the delay from that dep.
      let earliestMs = ctx.now.getTime();
      let dominantDepId: string | null = null;
      if (op.startDate) {
        const backwardMs = new Date(op.startDate).getTime();
        if (backwardMs > earliestMs) {
          earliestMs = backwardMs;
        }
      }
      for (const depId of depsByOperation.get(op.id) ?? []) {
        const depEnd = placedEndByOperation.get(depId);
        if (depEnd && depEnd.getTime() > earliestMs) {
          earliestMs = depEnd.getTime();
          dominantDepId = depId;
        }
      }
      const earliestStart = new Date(earliestMs);
      // Cap at the precomputed windows: walking past them finds nothing and
      // would flag feasible far-future ops as capacity conflicts
      const horizonEnd = new Date(
        Math.min(
          earliestMs + ctx.horizonDays * 24 * 3_600_000,
          ctx.windowsEnd.getTime()
        )
      );

      // The operation's requirement comes from its PROCESS (single ability)
      const requirement =
        ctx.requirementByProcess.get(op.processId) ?? null;
      const members = requirement
        ? this.buildEligibleMembers(requirement, earliestStart, ctx)
        : null;

      const durationHours =
        op.durationHours ??
        calculateDurationHours({ ...op, priority: op.priority ?? undefined });
      // Hands-on window (setup + labor); the rest of the span runs lights-out
      const attendedHours = Math.min(
        calculateAttendedHours({ ...op, priority: op.priority ?? undefined }),
        durationHours
      );
      // Split components for crew team mode (labor parallelizes across the
      // present crew; setup and machine time don't)
      const breakdown = calculateDurationBreakdown({
        ...op,
        priority: op.priority ?? undefined,
      });
      const teamComponents = {
        setupHours: breakdown.setupHours,
        laborHours: breakdown.laborHours,
        machineHours: breakdown.machineHours,
      };

      let best: {
        wcId: string;
        slot: AttendedAllocationSuccess;
        reservedMs: number;
        capacity: ResourceCapacityData;
        crewManned: boolean;
      } | null = null;
      let firstConflict: string | null = null;

      if (requirement && members && members.length === 0 && attendedHours > 0) {
        // Nobody qualified can ever free up — named conflict, no walk needed
        firstConflict = `No qualified operator for ${requirement.abilityName}`;
      } else {
        for (const wcId of candidates) {
          const capacity = ctx.capacityByWorkCenter.get(wcId);
          if (!capacity) continue;

          const crew = crewInfoForWorkCenter(ctx, wcId);

          let slot: AttendedAllocationSuccess;
          let crewManned = false;
          if (requirement) {
            // Pass 1 (soft prefer): when the station has crew, the crewed
            // QUALIFIED people work the op TOGETHER on their crewed days
            // (team mode: everyone booked on the same op, labor parallelized
            // across whoever is present; setup/machine not). A pass-1 miss is
            // not a conflict; pass 2 is today's any-qualified relay behavior.
            let result: AttendedAllocationSuccess | null = null;
            if (crew) {
              const crewQualified = (members ?? []).flatMap((m) => {
                const dates = crew.memberCrewDates.get(m.employeeId);
                if (!dates) return [];
                const windows = clipWindowsToStation(
                  m.windows,
                  wcId,
                  dates,
                  ctx.crewBudgets.get(m.employeeId),
                  ctx.timeZone
                );
                return windows.length > 0
                  ? [{ employeeId: m.employeeId, windows }]
                  : [];
              });
              if (crewQualified.length > 0) {
                const pass1 = allocateAttendedOperation({
                  attendedHours,
                  totalHours: durationHours,
                  earliestStart,
                  horizonEnd,
                  capacity,
                  members: crewQualified,
                  busyByEmployee: ctx.reservationsByEmployee,
                  timeZone: ctx.timeZone,
                  team: teamComponents,
                });
                if (!isConflict(pass1)) {
                  result = pass1;
                  crewManned = true;
                }
              }
            }
            if (!result) {
              const pass2 = allocateAttendedOperation({
                attendedHours,
                totalHours: durationHours,
                earliestStart,
                horizonEnd,
                capacity,
                members: members ?? [],
                busyByEmployee: ctx.reservationsByEmployee,
                timeZone: ctx.timeZone,
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
            // Ungated op: a crewed station is MANNED — the crew works the op
            // together (team mode: labor parallelized across whoever is
            // present, setup/machine not), machine holding the full span.
            // Falls back to machine-only (soft) when the crew can't cover
            // it; an uncrewed station is machine-only exactly as before.
            let result: AttendedAllocationSuccess | null = null;
            if (crew && attendedHours > 0) {
              const crewMembers: EligibleMember[] = [];
              for (const [employeeId, dates] of crew.memberCrewDates) {
                const windows = clipWindowsToStation(
                  ctx.windowsByEmployee.get(employeeId) ?? [],
                  wcId,
                  dates,
                  ctx.crewBudgets.get(employeeId),
                  ctx.timeZone
                );
                if (windows.length > 0) {
                  crewMembers.push({ employeeId, windows });
                }
              }
              if (crewMembers.length > 0) {
                const manned = allocateAttendedOperation({
                  attendedHours,
                  totalHours: durationHours,
                  earliestStart,
                  horizonEnd,
                  capacity,
                  members: crewMembers,
                  busyByEmployee: ctx.reservationsByEmployee,
                  timeZone: ctx.timeZone,
                  team: teamComponents,
                });
                if (!isConflict(manned)) {
                  result = manned;
                  crewManned = true;
                }
              }
            }
            if (!result) {
              const machineOnly = allocateOperation({
                durationHours,
                earliestStart,
                horizonEnd,
                capacity,
                timeZone: ctx.timeZone,
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
                wait: machineOnly.wait,
              };
            }
            slot = result;
          }

          const reservedMs = capacity.reservations.reduce(
            (sum, r) => sum + (r.endAt.getTime() - r.startAt.getTime()),
            0
          );

          if (
            !best ||
            slot.end.getTime() < best.slot.end.getTime() ||
            (slot.end.getTime() === best.slot.end.getTime() &&
              reservedMs < best.reservedMs)
          ) {
            best = { wcId, slot, reservedMs, capacity, crewManned };
          }
        }
      }

      if (best) {
        const { wcId, slot, capacity } = best;

        // Why does this op start when it does? The allocator attributed the
        // wait to the binding resource (machine queue vs operator pool) on
        // the chosen candidate's walk. Classified once; feeds the
        // always-stored placement note AND the late-only conflict message.
        const waitedMs = slot.start.getTime() - earliestMs;
        const cause = classifyLatePlacement({
          waitedMs,
          wait: slot.wait,
          dominantDep: dominantDepId
            ? { description: descriptionById.get(dominantDepId) ?? null }
            : null,
          crewManned: best.crewManned,
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
          workHours: durationHours,
        });
        // Book the named people for their attended segments — in-run (so no
        // later op double-books them, on ANY ability) and persisted
        for (const segment of slot.segments) {
          const list =
            ctx.reservationsByEmployee.get(segment.employeeId) ?? [];
          list.push({ startAt: segment.startAt, endAt: segment.endAt });
          ctx.reservationsByEmployee.set(segment.employeeId, list);
          this.plannedReservations.push({
            resourceKind: "Employee",
            resourceId: segment.employeeId,
            operationId: op.id,
            startAt: segment.startAt,
            endAt: segment.endAt,
            workHours:
              (segment.endAt.getTime() - segment.startAt.getTime()) /
              3_600_000,
          });
        }
        placedEndByOperation.set(op.id, slot.end);

        // Late vs the JOB due date => surface as a conflict naming the cause
        let conflict: string | null = null;
        const placedEndDate = businessDay(slot.end.toISOString(), ctx.timeZone);
        if (jobDueDate && placedEndDate > jobDueDate) {
          conflict = composeLateConflict(placedEndDate, jobDueDate, cause);
        }

        selections.set(op.id, {
          workCenterId: wcId,
          priority: 0,
          placedStart: slot.start.toISOString(),
          placedEnd: slot.end.toISOString(),
          conflict,
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
            (sum, r) => sum + (r.endAt.getTime() - r.startAt.getTime()),
            0
          );
          if (reservedMs < leastReserved) {
            leastReserved = reservedMs;
            fallbackWc = wcId;
          }
        }
        selections.set(op.id, {
          workCenterId: fallbackWc ?? op.workCenterId ?? null,
          priority: 0,
          conflict: firstConflict ?? "No feasible capacity slot",
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
    earliestStart: Date,
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
  hasPreassignedWorkCenter,
} from "./apply-work-center-selections.ts";
