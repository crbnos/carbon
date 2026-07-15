import { calculateDurationHours } from "./duration-calculator.ts";
import {
  classifyLatePlacement,
  composeLateConflict,
  composePlacementNote,
} from "./conflict-messages.ts";
import type { CalendarWindow } from "./calendar-utils.ts";
import type { MasterDataProvider } from "./master-data-provider.ts";
import {
  isEligibleOperator,
  type QualifiedEmployee,
} from "./operator-eligibility.ts";
import {
  allocateOperation,
  formatBlockingJobs,
  isConflict,
  type OperatorPool,
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
  poolReservationsByAbility: Map<string, ReservationInterval[]>;
  dependencies: JobOperationDependency[];
  now: Date;
  horizonDays: number;
  /**
   * When true (reschedule mode), an operation that already has a work center
   * keeps it — only timing/conflicts are recomputed. Work centers are only
   * (re)selected at initial scheduling, or manually on the operations board.
   */
  stickyWorkCenters: boolean;
};

/**
 * Work Center Selector — finite placement. Every work center is finite with
 * capacity 1 (one operation at a time); ability-gated operations additionally
 * wait for a qualified person to be on shift.
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
   * every candidate work center forward to the first interval where the
   * machine is free AND (when the process requires an ability) a qualified
   * person is on shift; pick the candidate with the earliest finish (tie →
   * least reserved time). Conflicts surface on the selection, never fail hard.
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
      if (op.operationType === "Outside") {
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
        const outsideEndDate = end.toISOString().slice(0, 10);
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
      const horizonEnd = new Date(
        earliestMs + ctx.horizonDays * 24 * 3_600_000
      );

      // The operation's requirement comes from its PROCESS (single ability)
      const requirement =
        ctx.requirementByProcess.get(op.processId) ?? null;
      const pool = requirement
        ? this.buildOperatorPool(requirement, earliestStart, ctx)
        : null;

      const durationHours =
        op.durationHours ??
        calculateDurationHours({ ...op, priority: op.priority ?? undefined });

      let best: {
        wcId: string;
        slot: { start: Date; end: Date };
        reservedMs: number;
        capacity: ResourceCapacityData;
      } | null = null;
      let firstConflict: string | null = null;

      for (const wcId of candidates) {
        const capacity = ctx.capacityByWorkCenter.get(wcId);
        if (!capacity) continue;

        const result = allocateOperation({
          durationHours,
          earliestStart,
          horizonEnd,
          capacity,
          operatorPool: pool,
        });

        if (isConflict(result)) {
          if (!firstConflict) {
            firstConflict = result.conflict;
          }
          continue;
        }

        const reservedMs = capacity.reservations.reduce(
          (sum, r) => sum + (r.endAt.getTime() - r.startAt.getTime()),
          0
        );

        if (
          !best ||
          result.end.getTime() < best.slot.end.getTime() ||
          (result.end.getTime() === best.slot.end.getTime() &&
            reservedMs < best.reservedMs)
        ) {
          best = { wcId, slot: result, reservedMs, capacity };
        }
      }

      if (best) {
        const { wcId, slot, capacity } = best;

        // Who is ahead of us in the queue? Other jobs' reservations in the
        // region between when we could have started and when we actually
        // did. Captured before this op's own interval is committed.
        const blockers = formatBlockingJobs(
          capacity.reservations,
          earliestStart,
          slot.start
        );
        // Untagged reservations in the wait region are this job's own earlier
        // operations on the same work center (in-run pushes carry no job id)
        const ownJobAhead = capacity.reservations.some(
          (r) =>
            !r.readableJobId &&
            r.startAt.getTime() < slot.start.getTime() &&
            r.endAt.getTime() > earliestMs
        );

        // Why does this op start when it does? Classified once; feeds the
        // always-stored placement note AND the late-only conflict message.
        const waitedMs = slot.start.getTime() - earliestMs;
        const cause = classifyLatePlacement({
          waitedMs,
          blockers,
          ownJobAhead,
          dominantDep: dominantDepId
            ? { description: descriptionById.get(dominantDepId) ?? null }
            : null,
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
        });
        if (requirement) {
          const list =
            ctx.poolReservationsByAbility.get(requirement.abilityId) ?? [];
          list.push({ startAt: slot.start, endAt: slot.end });
          ctx.poolReservationsByAbility.set(requirement.abilityId, list);
          this.plannedReservations.push({
            resourceKind: "OperatorPool",
            resourceId: requirement.abilityId,
            operationId: op.id,
            startAt: slot.start,
            endAt: slot.end,
          });
        }
        placedEndByOperation.set(op.id, slot.end);

        // Late vs the JOB due date => surface as a conflict naming the cause
        let conflict: string | null = null;
        const placedEndDate = slot.end.toISOString().slice(0, 10);
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

  private buildOperatorPool(
    requirement: ProcessRequirement,
    earliestStart: Date,
    ctx: FiniteSchedulingContext
  ): OperatorPool {
    const employees = ctx.employeesByAbility.get(requirement.abilityId) ?? [];

    const members = employees
      .filter((e) => isEligibleOperator(e, earliestStart))
      .map((e) => ({ employeeId: e.employeeId, windows: e.windows }));

    // Return the SAME array instance stored in the context so in-run pushes
    // are visible to later allocations
    let reservations = ctx.poolReservationsByAbility.get(requirement.abilityId);
    if (!reservations) {
      reservations = [];
      ctx.poolReservationsByAbility.set(requirement.abilityId, reservations);
    }

    return {
      abilityId: requirement.abilityId,
      abilityName: requirement.abilityName,
      members,
      reservations,
    };
  }
}

export { applyWorkCenterSelections } from "./apply-work-center-selections.ts";
