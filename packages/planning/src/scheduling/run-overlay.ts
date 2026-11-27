// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { startedOperationWorkCenter } from "./apply-work-center-selections.ts";
import { addWorkingTime, type CalendarWindow } from "./calendar-utils.ts";
import { toIsoDate } from "./date-utils.ts";
import { remainingWorkHours } from "./duration-calculator.ts";
import type {
  CrossJobOperation,
  LiveReservation
} from "./master-data-provider.ts";
import {
  allocateOperation,
  isConflict,
  type ResourceCapacityData
} from "./slot-allocator.ts";
import {
  type BaseOperation,
  capacityHoldingJobStatuses,
  type PlannedReservation,
  type ScheduledOperation
} from "./types.ts";

/**
 * A location run computes every job in memory and writes once at the end, so
 * a later job cannot read an earlier job's result from the database. These
 * are the rules for what it sees instead; each one states what the database
 * would have returned had the earlier job been written first.
 */

export const PLACEMENT_CASTS = {
  startDate: "date",
  projectedCompletionAt: "timestamptz",
  dueDate: "date",
  priority: "float8",
  workCenterId: "text",
  hasConflict: "boolean",
  conflictReason: "text"
} as const;

export type PlacementColumn = keyof typeof PLACEMENT_CASTS;
export type PlacementWrite = Partial<Record<PlacementColumn, unknown>>;

export type DependencyEdge = { operationId: string; dependsOnId: string };

/** Everything one job's schedule run wants written. */
export type JobWrites = {
  jobId: string;
  jobStatus: string | null;
  materialLinks: { materialId: string; jobOperationId: string }[];
  /** Null when the stored non-rework edges already equal the computed ones. */
  dependencies: { reworkOpIds: string[]; edges: DependencyEdge[] } | null;
  readyOperationIds: string[];
  placements: { id: string; placement: PlacementWrite }[];
  reservations: PlannedReservation[];
  projectedCompletionAt: string | null;
};

/**
 * The `jobOperation` columns one job's run writes, per operation.
 *
 * - `workCenterId` is the one `applyWorkCenterSelections` settled on.
 * - `dueDate` (the backward need-by target) is diff-written: only when it
 *   changed, so a quiet regen writes none, and never for a pinned op
 *   (`manuallyScheduled`: a human owns that target).
 */
export function placementWrites(args: {
  scheduled: Iterable<ScheduledOperation>;
  /** The stored operations, as the run loaded them. */
  originals: Pick<
    BaseOperation,
    "id" | "workCenterId" | "dueDate" | "manuallyScheduled"
  >[];
  needByByOperation: Map<string, string | null>;
}): JobWrites["placements"] {
  const originalById = new Map(args.originals.map((op) => [op.id, op]));
  const placements: JobWrites["placements"] = [];
  for (const op of args.scheduled) {
    const original = originalById.get(op.id);
    const needBy = args.needByByOperation.get(op.id) ?? null;
    const writeDueDate =
      !(original?.manuallyScheduled ?? false) &&
      needBy !== toIsoDate(original?.dueDate ?? null);
    const placement: PlacementWrite = {
      startDate: op.startDate,
      projectedCompletionAt: op.projectedCompletionAt ?? null,
      ...(writeDueDate ? { dueDate: needBy } : {}),
      ...(op.priority != null ? { priority: op.priority } : {}),
      workCenterId: op.workCenterId ?? original?.workCenterId ?? null,
      hasConflict: op.hasConflict,
      conflictReason: op.conflictReason
    };
    placements.push({ id: op.id, placement });
  }
  return placements;
}

export function dependencyEdgesEqual(
  stored: DependencyEdge[],
  computed: DependencyEdge[]
): boolean {
  const key = (e: DependencyEdge) => `${e.operationId}\u0000${e.dependsOnId}`;
  const storedKeys = new Set(stored.map(key));
  const computedKeys = new Set(computed.map(key));
  if (storedKeys.size !== computedKeys.size) return false;
  for (const k of computedKeys) if (!storedKeys.has(k)) return false;
  return true;
}

/**
 * The reservations of a just-scheduled job that hold capacity against the
 * jobs after it: the filters of the live-reservation read, applied to rows
 * that are not stored yet.
 */
export function visibleReservations(
  writes: Pick<JobWrites, "jobId" | "jobStatus" | "reservations">,
  readableJobId: string,
  now: number
): LiveReservation[] {
  if (
    !(capacityHoldingJobStatuses as readonly string[]).includes(
      writes.jobStatus ?? ""
    )
  ) {
    return [];
  }
  return writes.reservations
    .filter((r) => !r.isPlaceholder && r.endAt > now)
    .map((r) => ({
      resourceKind: r.resourceKind,
      resourceId: r.resourceId,
      startAt: r.startAt,
      endAt: r.endAt,
      jobId: writes.jobId,
      readableJobId,
      jobOperationBatchId: null
    }));
}

/**
 * Operations at these work centers: the stored rows, with every operation an
 * earlier job of the run placed replaced by its new placement. A placed
 * operation appears only at the work center it now has.
 */
export function mergeCrossJobOperations(
  stored: CrossJobOperation[],
  placed: ReadonlyMap<string, CrossJobOperation>,
  workCenterIds: string[]
): CrossJobOperation[] {
  const requested = new Set(workCenterIds);
  const merged = stored.filter((op) => !op.id || !placed.has(op.id));
  for (const op of placed.values()) {
    if (op.workCenterId && requested.has(op.workCenterId)) merged.push(op);
  }
  return merged;
}

/** One started operation the run holds resources for before any job runs. */
export type StartedOperationHold = {
  jobId: string;
  readableJobId: string;
  operationId: string;
  processId: string | null;
  workCenterId: string;
  /** The work left: setup (until it has an event) + max(labor, machine). */
  hours: number;
  /** The hands-on part of `hours` (setup + labor), done first. */
  attendedHours: number;
};

/**
 * The run's started operations whose machines are held before any job runs,
 * in the run's job order. Only capacity-holding jobs; batch members
 * (`skipOperationIds`) hold their batch's reservation instead, and outside
 * operations hold nothing.
 */
export function startedOperationsToHold(args: {
  jobs: {
    jobId: string;
    readableJobId: string;
    status: string | null;
    operations: BaseOperation[];
  }[];
  skipOperationIds: Set<string>;
  operationsWithEvents: Set<string>;
  /** The work centers active at the run's location (the selector's rule). */
  validWorkCenterIds: Set<string>;
}): StartedOperationHold[] {
  const held: StartedOperationHold[] = [];
  for (const job of args.jobs) {
    if (
      !(capacityHoldingJobStatuses as readonly string[]).includes(
        job.status ?? ""
      )
    ) {
      continue;
    }
    for (const op of job.operations) {
      // Only where the selector will place it: the same rule it uses.
      const workCenterId = startedOperationWorkCenter(
        op,
        args.validWorkCenterIds
      );
      if (
        !op.id ||
        !workCenterId ||
        op.status === "Done" ||
        op.status === "Canceled" ||
        op.operationType === "Outside Processing" ||
        args.skipOperationIds.has(op.id)
      ) {
        continue;
      }
      const remaining = remainingWorkHours(
        op,
        args.operationsWithEvents.has(op.id)
      );
      held.push({
        jobId: job.jobId,
        readableJobId: job.readableJobId,
        operationId: op.id,
        processId: op.processId ?? null,
        workCenterId,
        hours: remaining.durationHours,
        attendedHours: remaining.attendedHours
      });
    }
  }
  return held;
}

/**
 * Where the run's STARTED operations hold their machines before any job runs.
 * Jobs run in priority order, so a later job's running operation would
 * otherwise queue behind an earlier job's unstarted work on the same machine.
 * Each hold is the earliest span from `now` for the work the operation has
 * left on the work center it runs on, taken in the order given, around the
 * reservations no job of the run rewrites. The people working a gated op
 * (`employeeIds`) are held for its hands-on part from the same start, only
 * inside the machine's open windows. A job sees the holds of the jobs that
 * have not run yet; its own run releases them and places the operation
 * itself, so it never books against its own hold.
 */
export function startedOperationHolds(args: {
  operations: {
    jobId: string;
    readableJobId: string;
    workCenterId: string;
    hours: number;
    /** The hands-on part of `hours`, done first. Defaults to `hours`. */
    attendedHours?: number;
    /**
     * The people working the op now (an open Labor event), when its process
     * requires an ability. Each is held for the hands-on part of the hold.
     */
    employeeIds?: string[];
  }[];
  windowsByWorkCenter: Map<string, CalendarWindow[]>;
  reservations: LiveReservation[];
  now: number;
  horizonEnd: number;
  timeZone: string;
}): LiveReservation[] {
  const capacityByWorkCenter = new Map<string, ResourceCapacityData>();
  const holds: LiveReservation[] = [];
  for (const op of args.operations) {
    if (op.hours <= 0) continue;
    let capacity = capacityByWorkCenter.get(op.workCenterId);
    if (!capacity) {
      capacity = {
        workCenter: { id: op.workCenterId },
        windows: args.windowsByWorkCenter.get(op.workCenterId) ?? [],
        reservations: args.reservations
          .filter(
            (r) =>
              r.resourceKind === "WorkCenter" &&
              r.resourceId === op.workCenterId
          )
          .map((r) => ({ startAt: r.startAt, endAt: r.endAt }))
      };
      capacityByWorkCenter.set(op.workCenterId, capacity);
    }
    const slot = allocateOperation({
      durationHours: op.hours,
      earliestStart: args.now,
      horizonEnd: args.horizonEnd,
      capacity,
      timeZone: args.timeZone
    });
    if (isConflict(slot)) continue;
    capacity.reservations.push({ startAt: slot.start, endAt: slot.end });
    holds.push({
      resourceKind: "WorkCenter",
      resourceId: op.workCenterId,
      startAt: slot.start,
      endAt: slot.end,
      jobId: op.jobId,
      readableJobId: op.readableJobId,
      jobOperationBatchId: null
    });
    // The operator works the hands-on part first, on the machine's hours.
    const attendedHours = Math.min(op.attendedHours ?? op.hours, op.hours);
    const attendedEnd = Math.min(
      addWorkingTime(slot.start, attendedHours * 3_600_000, capacity.windows) ??
        slot.end,
      slot.end
    );
    if (attendedEnd <= slot.start) continue;
    // Only while the machine is open: a closed gap inside the span (a night,
    // a break) leaves the person free for other work.
    const attended: { startAt: number; endAt: number }[] = [];
    for (const w of capacity.windows) {
      const startAt = Math.max(w.start, slot.start);
      const endAt = Math.min(w.end, attendedEnd);
      if (endAt > startAt) attended.push({ startAt, endAt });
    }
    for (const employeeId of new Set(op.employeeIds ?? [])) {
      for (const { startAt, endAt } of attended) {
        holds.push({
          resourceKind: "Employee",
          resourceId: employeeId,
          startAt,
          endAt,
          jobId: op.jobId,
          readableJobId: op.readableJobId,
          jobOperationBatchId: null
        });
      }
    }
  }
  return holds;
}
