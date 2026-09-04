import type { DB } from "@carbon/database/client";
import type { BatchType } from "@carbon/utils";
import { batchDuration } from "@carbon/utils";
import type { Kysely } from "kysely";
import type { CalendarWindow } from "./calendar-utils.ts";
import { msToInstantIso, toInstantMs } from "./date-utils.ts";
import { calculateDurationBreakdown } from "./duration-calculator.ts";
import type { KyselyMasterDataProvider } from "./master-data-provider.ts";
import { allocateOperation, isConflict } from "./slot-allocator.ts";

/**
 * Batch pre-pass: place every RELEASED (`Active`/`Completing`) operation batch
 * at the location as ONE scheduling unit — one coalesced work-center
 * reservation tagged `jobOperationBatchId`, members pinned to the window —
 * BEFORE the per-job forward passes run. The per-job passes then treat member
 * operations as fixed-window (like pinned Outside Processing) and chain each
 * member's downstream after the batch end.
 *
 * Anchoring: the batch starts no earlier than `max(now, member predecessors'
 * PERSISTED projectedCompletionAt)` — the engine's own last-wave forecasts
 * (precedent: the need-by pass reads stored pins). A predecessor freshly
 * placed later than the batch start this wave surfaces as a conflict flag on
 * the member (in the selector), and the next wave converges.
 *
 * Duration follows `process.batchType`: `setup(max) + Σ run` (Sequential) or
 * `setup(max) + max run` (Simultaneous), net of progress via the shared
 * `batchDuration` from `@carbon/utils` — the same helper the builder estimate
 * uses, so the reservation and the UI can never disagree.
 *
 * `Planned` batches are deliberately NOT here — their members schedule per-op
 * exactly as before release (bounded residual over-booking that disappears at
 * release). Employee finiteness is also deliberately absent in v1: the batch
 * reserves the work center only (one crew on one machine; documented
 * optimism for ability-gated batchable processes).
 */

export type BatchPlacement = {
  batchId: string;
  batchReadableId: string | null;
  workCenterId: string;
  /** epoch-ms window the members are pinned to */
  startAt: number;
  endAt: number;
  /** Set when the batch got a placeholder window instead of a real slot. */
  conflict: string | null;
};

export type BatchMemberInput = {
  id: string;
  jobId: string;
  /** full planned content, seconds (gross — batchDuration nets internally) */
  setupSeconds: number;
  laborSeconds: number;
  machineSeconds: number;
  operationQuantity: number;
  quantityComplete: number;
  /** Done/Canceled members contribute nothing and are not pinned */
  isOpen: boolean;
  /** max persisted projectedCompletionAt of upstream ops in the same method, epoch-ms */
  predecessorEndMs: number | null;
};

export type BatchToPlace = {
  id: string;
  readableId: string | null;
  workCenterId: string | null;
  batchType: BatchType;
  hasAnyEvent: boolean;
  members: BatchMemberInput[];
};

export type PlacedBatchReservation = {
  batchId: string;
  workCenterId: string;
  /** deterministic anchor: the min open member op id (columns are NOT NULL) */
  anchorOperationId: string;
  anchorJobId: string;
  startAt: number;
  endAt: number;
  workHours: number;
  isPlaceholder: boolean;
};

type WorkCenterReservationInterval = {
  startAt: number;
  endAt: number;
  readableJobId?: string;
};

/**
 * Pure planning core (unit-tested): deterministic order, anchor, duration,
 * slot search, in-memory accumulation so later batches see earlier ones.
 */
export function planBatchPlacements(args: {
  batches: BatchToPlace[];
  /** the location run's job order — batches claim in their best member's turn */
  orderedJobIds: string[];
  now: number;
  horizonEnd: number;
  timeZone: string;
  windowsByWorkCenter: Map<string, CalendarWindow[]>;
  reservationsByWorkCenter: Map<string, WorkCenterReservationInterval[]>;
}): {
  placements: Map<string, BatchPlacement>;
  reservations: PlacedBatchReservation[];
} {
  const {
    batches,
    orderedJobIds,
    now,
    horizonEnd,
    timeZone,
    windowsByWorkCenter,
    reservationsByWorkCenter
  } = args;

  const placements = new Map<string, BatchPlacement>();
  const reservationRows: PlacedBatchReservation[] = [];

  // Deterministic batch order: the position of the batch's best-placed member
  // job in the run's deadline/priority order, tie-broken by batch id.
  const jobRank = new Map<string, number>();
  orderedJobIds.forEach((id, i) => jobRank.set(id, i));
  const rankOf = (batch: BatchToPlace): number => {
    let best = Number.POSITIVE_INFINITY;
    for (const m of batch.members) {
      const r = jobRank.get(m.jobId);
      if (r !== undefined && r < best) best = r;
    }
    return best;
  };
  const ordered = [...batches].sort((a, b) => {
    const dr = rankOf(a) - rankOf(b);
    if (dr !== 0) return dr;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // Local accumulation: a placed batch blocks the machine for the batches
  // after it (placeholders never block, mirroring the engine).
  const accumulated = new Map<string, WorkCenterReservationInterval[]>();
  const intervalsFor = (wcId: string): WorkCenterReservationInterval[] => [
    ...(reservationsByWorkCenter.get(wcId) ?? []),
    ...(accumulated.get(wcId) ?? [])
  ];

  for (const batch of ordered) {
    // A Released batch without a work center (legacy pre-rule rows — release
    // now requires one) cannot be coalesced; its members place individually,
    // exactly the pre-feature behavior. Graceful degradation, not an error.
    if (!batch.workCenterId) continue;
    const workCenterId = batch.workCenterId;

    const open = batch.members.filter((m) => m.isOpen);
    if (open.length === 0) continue;

    const durationSeconds = batchDuration(
      open.map((m) => ({
        setupDuration: m.setupSeconds,
        laborDuration: m.laborSeconds,
        machineDuration: m.machineSeconds,
        operationQuantity: m.operationQuantity,
        quantityComplete: m.quantityComplete
      })),
      batch.batchType,
      { hasAnyEvent: batch.hasAnyEvent }
    );
    if (durationSeconds <= 0) continue;
    const durationHours = durationSeconds / 3_600;

    let anchor = now;
    for (const m of open) {
      if (m.predecessorEndMs !== null && m.predecessorEndMs > anchor) {
        anchor = m.predecessorEndMs;
      }
    }

    const capacity = {
      workCenter: { id: workCenterId, alwaysOn: false },
      windows: windowsByWorkCenter.get(workCenterId) ?? [],
      reservations: intervalsFor(workCenterId)
    };

    const allocation = allocateOperation({
      durationHours,
      earliestStart: anchor,
      horizonEnd,
      capacity,
      timeZone
    });

    let startAt: number;
    let endAt: number;
    let conflict: string | null = null;
    let isPlaceholder = false;
    if (isConflict(allocation)) {
      // Mirror the engine's unplaceable-op pattern: a non-binding placeholder
      // window (calendar time from the anchor) that surfaces the batch on the
      // forecast without holding the machine.
      startAt = anchor;
      endAt = anchor + durationHours * 3_600_000;
      conflict = allocation.conflict;
      isPlaceholder = true;
    } else {
      startAt = allocation.start;
      endAt = allocation.end;
      const list = accumulated.get(workCenterId) ?? [];
      list.push({
        startAt,
        endAt,
        readableJobId: batch.readableId ?? undefined
      });
      accumulated.set(workCenterId, list);
    }

    for (const m of open) {
      placements.set(m.id, {
        batchId: batch.id,
        batchReadableId: batch.readableId,
        workCenterId,
        startAt,
        endAt,
        conflict
      });
    }

    const anchorMember = [...open].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    )[0]!;
    reservationRows.push({
      batchId: batch.id,
      workCenterId,
      anchorOperationId: anchorMember.id,
      anchorJobId: anchorMember.jobId,
      startAt,
      endAt,
      workHours: durationHours,
      isPlaceholder
    });
  }

  return { placements, reservations: reservationRows };
}

/**
 * I/O wrapper: load Released batches + members + predecessors + availability,
 * run the pure core, and (when `persist`) rewrite the batch-tagged
 * `capacityReservation` rows in one transaction.
 *
 * `persist: false` (expedite what-if) reuses the EXISTING batch rows as the
 * placement map instead of recomputing — the simulation must agree with the
 * reservations its snapshot already contains.
 */
export async function placeReleasedBatches(args: {
  db: Kysely<DB>;
  provider: KyselyMasterDataProvider;
  companyId: string;
  locationId: string;
  now: number;
  userId: string;
  orderedJobIds: string[];
  horizonEnd: number;
  persist: boolean;
}): Promise<Map<string, BatchPlacement>> {
  const {
    db,
    provider,
    companyId,
    locationId,
    now,
    userId,
    orderedJobIds,
    horizonEnd,
    persist
  } = args;

  const batchRows = await db
    .selectFrom("jobOperationBatch as b")
    .innerJoin("process as p", (join) =>
      join
        .onRef("p.id", "=", "b.processId")
        .onRef("p.companyId", "=", "b.companyId")
    )
    .select(["b.id", "b.readableId", "b.workCenterId", "p.batchType"])
    .where("b.companyId", "=", companyId)
    .where("b.locationId", "=", locationId)
    .where("b.status", "in", ["Active", "Completing"])
    .execute();

  if (batchRows.length === 0) return new Map();
  const batchIds = batchRows.map((b) => b.id);

  const memberRows = await db
    .selectFrom("jobOperation")
    .select([
      "id",
      "jobId",
      "jobOperationBatchId",
      "jobMakeMethodId",
      "order",
      "status",
      "setupTime",
      "setupUnit",
      "laborTime",
      "laborUnit",
      "machineTime",
      "machineUnit",
      "operationQuantity",
      "quantityComplete"
    ])
    .where("companyId", "=", companyId)
    .where("jobOperationBatchId", "in", batchIds)
    .execute();

  if (persist === false) {
    // What-if: mirror the persisted rows, never rewrite them.
    const existing = await db
      .selectFrom("capacityReservation")
      .select(["jobOperationBatchId", "resourceId", "startAt", "endAt"])
      .where("companyId", "=", companyId)
      .where("jobOperationBatchId", "in", batchIds)
      .where("scenarioId", "is", null)
      .execute();
    const windowByBatch = new Map(
      existing.map((r) => [
        r.jobOperationBatchId as string,
        {
          workCenterId: r.resourceId,
          startAt: toInstantMs(r.startAt as unknown as Date | string),
          endAt: toInstantMs(r.endAt as unknown as Date | string)
        }
      ])
    );
    const readableByBatch = new Map(batchRows.map((b) => [b.id, b.readableId]));
    const placements = new Map<string, BatchPlacement>();
    for (const m of memberRows) {
      if (m.status === "Done" || m.status === "Canceled") continue;
      const w = m.jobOperationBatchId
        ? windowByBatch.get(m.jobOperationBatchId)
        : undefined;
      if (!w) continue;
      placements.set(m.id, {
        batchId: m.jobOperationBatchId!,
        batchReadableId: readableByBatch.get(m.jobOperationBatchId!) ?? null,
        workCenterId: w.workCenterId,
        startAt: w.startAt,
        endAt: w.endAt,
        conflict: null
      });
    }
    return placements;
  }

  // Batch-level "any event" — setup counts done once the shared timer ran.
  const eventRows = await db
    .selectFrom("productionEvent")
    .select("jobOperationBatchId")
    .distinct()
    .where("companyId", "=", companyId)
    .where("jobOperationBatchId", "in", batchIds)
    .execute();
  const batchesWithEvents = new Set(
    eventRows.map((r) => r.jobOperationBatchId).filter(Boolean) as string[]
  );

  // Predecessor forecasts: persisted projectedCompletionAt of same-method ops
  // with a lower topological "order". Ops in the SAME batch never anchor it
  // (self-reference), and Done/Canceled predecessors are historical — a past
  // instant loses to `now` in the anchor max anyway, so they can stay.
  const methodIds = [
    ...new Set(memberRows.map((m) => m.jobMakeMethodId).filter(Boolean))
  ] as string[];
  const memberIdSet = new Set(memberRows.map((m) => m.id));
  const predecessorRows = methodIds.length
    ? await db
        .selectFrom("jobOperation")
        .select(["id", "jobMakeMethodId", "order", "projectedCompletionAt"])
        .where("companyId", "=", companyId)
        .where("jobMakeMethodId", "in", methodIds)
        .where("projectedCompletionAt", "is not", null)
        .execute()
    : [];
  const predsByMethod = new Map<string, { order: number; endMs: number }[]>();
  for (const p of predecessorRows) {
    if (!p.jobMakeMethodId || memberIdSet.has(p.id)) continue;
    const list = predsByMethod.get(p.jobMakeMethodId) ?? [];
    list.push({
      order: Number(p.order ?? 0),
      endMs: toInstantMs(p.projectedCompletionAt as unknown as Date | string)
    });
    predsByMethod.set(p.jobMakeMethodId, list);
  }
  const predecessorEndFor = (m: (typeof memberRows)[number]): number | null => {
    if (!m.jobMakeMethodId) return null;
    const list = predsByMethod.get(m.jobMakeMethodId);
    if (!list) return null;
    const order = Number(m.order ?? 0);
    let max: number | null = null;
    for (const p of list) {
      if (p.order < order && (max === null || p.endMs > max)) {
        max = p.endMs;
      }
    }
    return max;
  };

  const membersByBatch = new Map<string, BatchMemberInput[]>();
  for (const m of memberRows) {
    if (!m.jobOperationBatchId) continue;
    const breakdown = calculateDurationBreakdown({
      id: m.id,
      setupTime: m.setupTime,
      setupUnit: m.setupUnit,
      laborTime: m.laborTime,
      laborUnit: m.laborUnit,
      machineTime: m.machineTime,
      machineUnit: m.machineUnit,
      operationQuantity: m.operationQuantity
    } as Parameters<typeof calculateDurationBreakdown>[0]);
    const list = membersByBatch.get(m.jobOperationBatchId) ?? [];
    list.push({
      id: m.id,
      jobId: m.jobId,
      setupSeconds: breakdown.setupHours * 3_600,
      laborSeconds: breakdown.laborHours * 3_600,
      machineSeconds: breakdown.machineHours * 3_600,
      operationQuantity: Number(m.operationQuantity ?? 0),
      quantityComplete: Number(m.quantityComplete ?? 0),
      isOpen: m.status !== "Done" && m.status !== "Canceled",
      predecessorEndMs: predecessorEndFor(m)
    });
    membersByBatch.set(m.jobOperationBatchId, list);
  }

  const batches: BatchToPlace[] = batchRows.map((b) => ({
    id: b.id,
    readableId: b.readableId,
    workCenterId: b.workCenterId,
    batchType: (b.batchType ?? "Sequential") as BatchType,
    hasAnyEvent: batchesWithEvents.has(b.id),
    members: membersByBatch.get(b.id) ?? []
  }));

  const workCenterIds = [
    ...new Set(batches.map((b) => b.workCenterId).filter(Boolean))
  ] as string[];
  const [windowsByWorkCenter, liveReservations, location] = await Promise.all([
    provider.getWorkCenterAvailability(workCenterIds, now, horizonEnd),
    provider.getLiveReservations(now, []),
    db
      .selectFrom("location")
      .select("timezone")
      .where("id", "=", locationId)
      .where("companyId", "=", companyId)
      .executeTakeFirst()
  ]);

  // Existing reservations per work center, MINUS this location's own batch
  // rows (they are being rewritten below and must not block themselves).
  const reservationsByWorkCenter = new Map<
    string,
    WorkCenterReservationInterval[]
  >();
  for (const r of liveReservations) {
    if (r.resourceKind !== "WorkCenter") continue;
    if (r.jobOperationBatchId && batchIds.includes(r.jobOperationBatchId)) {
      continue;
    }
    const list = reservationsByWorkCenter.get(r.resourceId) ?? [];
    list.push({
      startAt: r.startAt,
      endAt: r.endAt,
      readableJobId: r.readableJobId
    });
    reservationsByWorkCenter.set(r.resourceId, list);
  }

  const { placements, reservations } = planBatchPlacements({
    batches,
    orderedJobIds,
    now,
    horizonEnd,
    timeZone: location?.timezone ?? "UTC",
    windowsByWorkCenter,
    reservationsByWorkCenter
  });

  // One transaction: the old batch rows disappear only together with the new
  // ones appearing — the per-job runs that follow read a consistent set.
  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom("capacityReservation")
      .where("companyId", "=", companyId)
      .where("jobOperationBatchId", "in", batchIds)
      .execute();

    if (reservations.length > 0) {
      await trx
        .insertInto("capacityReservation")
        .values(
          reservations.map((r) => ({
            resourceKind: "WorkCenter" as const,
            resourceId: r.workCenterId,
            operationId: r.anchorOperationId,
            jobId: r.anchorJobId,
            jobOperationBatchId: r.batchId,
            companyId,
            startAt: msToInstantIso(r.startAt),
            endAt: msToInstantIso(r.endAt),
            workHours: r.workHours,
            isPlaceholder: r.isPlaceholder,
            createdBy: userId
          }))
        )
        .execute();
    }
  });

  return placements;
}
