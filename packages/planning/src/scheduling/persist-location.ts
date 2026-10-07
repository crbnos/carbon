// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DB } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import { type Kysely, sql, type Transaction } from "kysely";
import { msToInstantIso } from "./date-utils.ts";
import {
  type JobWrites,
  PLACEMENT_CASTS,
  type PlacementColumn,
  type PlacementWrite
} from "./run-overlay.ts";

const PLACEMENT_COLUMNS = Object.keys(PLACEMENT_CASTS) as PlacementColumn[];

// Postgres takes at most 65,535 parameters per statement.
const CHUNK = 1000;

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    out.push(rows.slice(i, i + CHUNK));
  }
  return out;
}

/**
 * Write the placements of operations that all set the same columns, in one
 * statement. Every UPDATE is queued for the audit/search handlers, so a row
 * whose placement is unchanged is not written at all.
 */
async function updatePlacements(
  trx: Transaction<DB>,
  rows: { id: string; placement: PlacementWrite }[],
  companyId: string,
  userId: string
) {
  const columns = PLACEMENT_COLUMNS.filter(
    (column) => rows[0]!.placement[column] !== undefined
  );
  const value = (column: PlacementColumn) =>
    sql`v.${sql.ref(column)}::${sql.raw(PLACEMENT_CASTS[column])}`;

  await sql`
    update "jobOperation" as o
    set ${sql.join([
      ...columns.map((c) => sql`${sql.ref(c)} = ${value(c)}`),
      sql`"updatedAt" = ${datetime.timestamp()}`,
      sql`"updatedBy" = ${userId}`
    ])}
    from (values ${sql.join(
      rows.map(
        (row) =>
          sql`(${sql.join([row.id, ...columns.map((c) => row.placement[c])])})`
      )
    )}) as v(${sql.join(["id", ...columns].map((c) => sql.ref(c)))})
    where o."id" = v."id"
      and o."companyId" = ${companyId}
      and ${
        columns.length === 0
          ? sql`true`
          : sql`(${sql.join(
              columns.map(
                (c) => sql`o.${sql.ref(c)} is distinct from ${value(c)}`
              ),
              sql` or `
            )})`
      }
  `.execute(trx);
}

/**
 * Write a whole location run in ONE transaction: a partial write (one job's
 * reservations deleted but not re-inserted, or half the jobs on the new plan)
 * would free or double-book capacity for the next run.
 */
export async function persistLocationWrites(
  db: Kysely<DB>,
  writes: JobWrites[],
  scope: { companyId: string; userId: string }
): Promise<void> {
  if (writes.length === 0) return;
  const { companyId, userId } = scope;

  await db.transaction().execute(async (trx) => {
    const links = writes.flatMap((w) => w.materialLinks);
    for (const rows of chunks(links)) {
      await sql`
        update "jobMaterial" as m
        set "jobOperationId" = v."jobOperationId"
        from (values ${sql.join(
          rows.map((r) => sql`(${r.materialId}, ${r.jobOperationId})`)
        )}) as v("id", "jobOperationId")
        where m."id" = v."id" and m."companyId" = ${companyId}
      `.execute(trx);
    }

    // The advisory lock serializes the rebuild per job: two runs for one job
    // can overlap (a retry racing a still-running invocation), and interleaved
    // delete/insert then violates jobOperationDependency_pk. onConflict
    // absorbs any edge that survives a race with trigger-rework's inserts.
    for (const { jobId, dependencies } of writes) {
      if (!dependencies) continue;
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:dependencies:${jobId}`}, 0))`.execute(
        trx
      );
      let deleteQuery = trx
        .deleteFrom("jobOperationDependency")
        .where("jobId", "=", jobId)
        .where("companyId", "=", companyId);
      // Rework operation dependencies are preserved.
      if (dependencies.reworkOpIds.length > 0) {
        deleteQuery = deleteQuery
          .where("operationId", "not in", dependencies.reworkOpIds)
          .where("dependsOnId", "not in", dependencies.reworkOpIds);
      }
      await deleteQuery.execute();
      for (const edges of chunks(dependencies.edges)) {
        await trx
          .insertInto("jobOperationDependency")
          .values(edges.map((e) => ({ ...e, jobId, companyId })))
          .onConflict((oc) =>
            oc.columns(["operationId", "dependsOnId"]).doNothing()
          )
          .execute();
      }
    }

    // Never re-open work that is finished (Done/Canceled) or in flight (In
    // Progress/Paused): only Waiting/Todo become Ready.
    for (const ids of chunks(writes.flatMap((w) => w.readyOperationIds))) {
      await trx
        .updateTable("jobOperation")
        .set({ status: "Ready" })
        .where("id", "in", ids)
        .where("companyId", "=", companyId)
        .where("status", "not in", [
          "Ready",
          "Done",
          "Canceled",
          "In Progress",
          "Paused"
        ])
        .execute();
    }

    // Rows that write the same columns go in one statement.
    const byShape = new Map<
      string,
      { id: string; placement: PlacementWrite }[]
    >();
    for (const row of writes.flatMap((w) => w.placements)) {
      const shape = PLACEMENT_COLUMNS.filter(
        (column) => row.placement[column] !== undefined
      ).join();
      const group = byShape.get(shape);
      if (group) group.push(row);
      else byShape.set(shape, [row]);
    }
    for (const group of byShape.values()) {
      for (const rows of chunks(group)) {
        await updatePlacements(trx, rows, companyId, userId);
      }
    }

    // Rebuild the jobs' live capacity reservations from this run's placements.
    // Batch-tagged rows are spared: a member job's regen must never destroy
    // the batch's coalesced reservation.
    for (const jobIds of chunks(writes.map((w) => w.jobId))) {
      await trx
        .deleteFrom("capacityReservation")
        .where("jobId", "in", jobIds)
        .where("companyId", "=", companyId)
        .where("scenarioId", "is", null)
        .where("jobOperationBatchId", "is", null)
        .execute();
    }
    const reservations = writes.flatMap((w) =>
      w.reservations.map((p) => ({
        resourceKind: p.resourceKind,
        resourceId: p.resourceId,
        operationId: p.operationId,
        jobId: w.jobId,
        companyId,
        startAt: msToInstantIso(p.startAt),
        endAt: msToInstantIso(p.endAt),
        earliestStartAt:
          p.earliestStartAt !== undefined
            ? msToInstantIso(p.earliestStartAt)
            : null,
        scheduleNote: p.scheduleNote ?? null,
        workHours: p.workHours ?? null,
        isPlaceholder: p.isPlaceholder ?? false,
        createdBy: userId
      }))
    );
    for (const rows of chunks(reservations)) {
      await trx.insertInto("capacityReservation").values(rows).execute();
    }

    // The forecast, and the stale-schedule stamps cleared with it. The
    // scheduler is status-neutral: releasing a job to Ready is the app's
    // job-status flow, never a side effect of scheduling.
    for (const rows of chunks(writes)) {
      await sql`
        update "job" as j
        set "projectedCompletionAt" = v."projectedCompletionAt"::timestamptz,
          "scheduleOutdatedReason" = null,
          "scheduleOutdatedAt" = null,
          "updatedAt" = ${datetime.timestamp()},
          "updatedBy" = ${userId}
        from (values ${sql.join(
          rows.map((w) => sql`(${w.jobId}, ${w.projectedCompletionAt})`)
        )}) as v("id", "projectedCompletionAt")
        where j."id" = v."id"
          and j."companyId" = ${companyId}
          and (
            j."projectedCompletionAt" is distinct from v."projectedCompletionAt"::timestamptz
            or j."scheduleOutdatedReason" is not null
            or j."scheduleOutdatedAt" is not null
          )
      `.execute(trx);
    }
  });
}
