// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toIsoDate } from "./date-utils.ts";
import type {
  CrossJobOperation,
  LiveReservation
} from "./master-data-provider.ts";
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
