import type { KyselyDatabase } from "@carbon/database/client";
import { findTriggerSchedule, nextRunAfter } from "@carbon/workflows";
import { type Kysely, sql } from "kysely";
import type { MatchResult } from "./matcher";
import { insertRunsAndBuildEvents, type PlannedRun } from "./matcher";

export const MAX_DUE_PER_WAKE = 200;
export const WAKE_CEILING_MS = 10 * 60 * 1000;
export const OVERFLOW_WAKE_MS = 30 * 1000;
export const STALE_AFTER_MS = 60 * 60 * 1000;
export const BACKSTOP_STALE_MS = 15 * 60 * 1000;
export const CHAIN_KEY = "workflows:scheduler:chain";
export const CHAIN_TTL_SECONDS = 7200;

export const SCHEDULE_EVENT_ID = "schedule";

export const PREVIOUS_RUN_ACTIVE =
  "The previous run was still going when this one came due.";
export const TOO_LATE =
  "This run came due more than an hour ago and was skipped rather than run late.";

export type DueWorkflow = {
  id: string;
  companyId: string;
  ownerId: string;
  publishedVersionId: string;
  nextRunAt: Date;
  nodes: unknown;
};

export async function scanDue(
  db: Kysely<KyselyDatabase>,
  now: Date
): Promise<{ due: DueWorkflow[]; earliestFuture: Date | null }> {
  const due = await db
    .selectFrom("workflow as w")
    .innerJoin("workflowVersion as v", (join) =>
      join
        .onRef("v.id", "=", "w.publishedVersionId")
        .onRef("v.companyId", "=", "w.companyId")
    )
    .select([
      "w.id",
      "w.companyId",
      "w.ownerId",
      "w.publishedVersionId",
      "w.nextRunAt",
      "v.nodes"
    ])
    // Reads as redundant beside the join, but it is what lets the planner match the partial
    // `workflow_due_idx` — a join qual cannot prove that index's predicate. Do not delete.
    .where("w.publishedVersionId", "is not", null)
    .where("w.nextRunAt", "<=", now.toISOString())
    .orderBy("w.nextRunAt", "asc")
    .limit(MAX_DUE_PER_WAKE)
    .execute();

  const futureRow = await db
    .selectFrom("workflow as w")
    .select("w.nextRunAt")
    .where("w.publishedVersionId", "is not", null)
    .where("w.nextRunAt", ">", now.toISOString())
    .orderBy("w.nextRunAt", "asc")
    .limit(1)
    .executeTakeFirst();

  return {
    due: due
      .filter(
        (r): r is typeof r & { publishedVersionId: string } =>
          r.publishedVersionId !== null
      )
      .map((r) => ({
        ...r,
        nextRunAt: new Date(r.nextRunAt as unknown as string)
      })),
    earliestFuture: futureRow?.nextRunAt
      ? new Date(futureRow.nextRunAt as unknown as string)
      : null
  };
}

/**
 * The ceiling is not optional. "The next due time" is only true at the moment it was read:
 * anything created, edited or re-enabled inside a five-hour sleep is invisible to a scheduler
 * already asleep. Capping at ten minutes bounds worst-case lateness for a NEW schedule.
 */
export function planWakeAt(params: {
  now: Date;
  earliestFuture: Date | null;
  overflow: boolean;
}): number {
  const { now, earliestFuture, overflow } = params;
  if (overflow) return now.getTime() + OVERFLOW_WAKE_MS;
  const ceiling = now.getTime() + WAKE_CEILING_MS;
  if (!earliestFuture) return ceiling;
  return Math.min(
    ceiling,
    Math.max(earliestFuture.getTime(), now.getTime() + 1000)
  );
}

const workflowKey = (companyId: string, workflowId: string) =>
  `${companyId}:${workflowId}`;

export type DueClaim = { row: DueWorkflow; recomputed: string };

/**
 * Splits a wake's due rows into the ones to re-book and the ones whose promoted
 * version stopped being schedule-triggered. The new time is computed from NOW,
 * not from dueAt, so a long outage can never queue a cascade of catch-up runs.
 */
export function planClaims(
  rows: DueWorkflow[],
  now: Date
): { unscheduled: DueWorkflow[]; claims: DueClaim[] } {
  const unscheduled: DueWorkflow[] = [];
  const claims: DueClaim[] = [];

  for (const row of rows) {
    const schedule = findTriggerSchedule(row.nodes);
    if (schedule) {
      claims.push({
        row,
        recomputed: nextRunAfter(schedule, row.id, now).toISOString()
      });
    } else {
      unscheduled.push(row);
    }
  }

  return { unscheduled, claims };
}

/**
 * `claimDue` for the whole wake in two statements. Each row needs its own
 * recomputed time, so the new values ride in as a VALUES join rather than a
 * single SET. The compare-and-set on the old `nextRunAt` is unchanged and still
 * per row, so a losing wake still claims nothing.
 */
export async function claimDueBatch(
  db: Kysely<KyselyDatabase>,
  rows: DueWorkflow[],
  now: Date
): Promise<Set<string>> {
  const { unscheduled, claims } = planClaims(rows, now);

  // Promoted version is no longer schedule-triggered — clear the due time.
  if (unscheduled.length > 0) {
    const values = unscheduled.map(
      (row) =>
        sql`(${row.id}::text, ${row.companyId}::text, ${row.nextRunAt.toISOString()}::timestamptz)`
    );
    await sql`
      UPDATE "workflow" AS w
      SET "nextRunAt" = NULL
      FROM (VALUES ${sql.join(values)}) AS v("id", "companyId", "expected")
      WHERE w."id" = v."id"
        AND w."companyId" = v."companyId"
        AND w."nextRunAt" = v."expected"
    `.execute(db);
  }

  if (claims.length === 0) return new Set();

  const values = claims.map(
    ({ row, recomputed }) =>
      sql`(${row.id}::text, ${row.companyId}::text, ${row.nextRunAt.toISOString()}::timestamptz, ${recomputed}::timestamptz)`
  );
  const claimed = await sql<{ id: string; companyId: string }>`
    UPDATE "workflow" AS w
    SET "nextRunAt" = v."next"
    FROM (VALUES ${sql.join(values)}) AS v("id", "companyId", "expected", "next")
    WHERE w."id" = v."id"
      AND w."companyId" = v."companyId"
      AND w."nextRunAt" = v."expected"
    RETURNING w."id", w."companyId"
  `.execute(db);

  return new Set(claimed.rows.map((row) => workflowKey(row.companyId, row.id)));
}

/**
 * One read for the whole wake instead of one per due workflow. Served by the
 * partial index `workflowRun_active_idx`; the pair is re-checked in JS because
 * the query filters workflowId as a list, not as (companyId, workflowId) pairs.
 */
async function activeRunKeys(
  db: Kysely<KyselyDatabase>,
  rows: DueWorkflow[]
): Promise<Set<string>> {
  if (rows.length === 0) return new Set();
  const found = await db
    .selectFrom("workflowRun")
    .select(["companyId", "workflowId"])
    .where(
      "workflowId",
      "in",
      rows.map((row) => row.id)
    )
    .where("status", "in", ["Queued", "Running"])
    .execute();

  return new Set(
    found.map((row) => workflowKey(row.companyId, row.workflowId))
  );
}

export async function dispatchDue(
  db: Kysely<KyselyDatabase>,
  now: Date
): Promise<{
  events: MatchResult["events"];
  queued: number;
  skipped: number;
  overflow: boolean;
}> {
  const { due } = await scanDue(db, now);
  const overflow = due.length === MAX_DUE_PER_WAKE;

  let queued = 0;
  let skipped = 0;
  const events: MatchResult["events"] = [];

  // The run insert below stays per workflow: each has its own sourceEventId, and
  // that is what the dedupe constraint keys on.
  const claimedKeys = await claimDueBatch(db, due, now);
  const claimedRows = due.filter((row) =>
    claimedKeys.has(workflowKey(row.companyId, row.id))
  );
  const activeKeys = await activeRunKeys(db, claimedRows);

  for (const row of claimedRows) {
    const dueAt = row.nextRunAt;
    const dueAtIso = dueAt.toISOString();

    let status: "Queued" | "Skipped";
    let statusReason: string | null = null;

    if (now.getTime() - dueAt.getTime() > STALE_AFTER_MS) {
      status = "Skipped";
      statusReason = TOO_LATE;
    } else if (activeKeys.has(workflowKey(row.companyId, row.id))) {
      status = "Skipped";
      statusReason = PREVIOUS_RUN_ACTIVE;
    } else {
      status = "Queued";
    }

    const planned: PlannedRun[] = [
      {
        workflowId: row.id,
        workflowVersionId: row.publishedVersionId,
        eventId: SCHEDULE_EVENT_ID,
        ownerId: row.ownerId,
        status,
        statusReason,
        rootRunId: null,
        causedByRunId: null,
        depth: 0,
        path: []
      }
    ];

    const result = await insertRunsAndBuildEvents(db, {
      companyId: row.companyId,
      sourceEventId: `schedule:${row.id}:${dueAtIso}`,
      triggerTable: null,
      triggerRecordId: null,
      trigger: { kind: "schedule", dueAt: dueAtIso },
      planned
    });

    if (status === "Queued") {
      queued += result.queued;
      events.push(...result.events);
    } else {
      skipped += 1;
    }
  }

  return { events, queued, skipped, overflow };
}

/** True if this wake is the live chain and may book the next one. */
export async function ownsChain(bookedFor: number | null): Promise<boolean> {
  if (bookedFor === null) return true; // the backstop always adopts
  try {
    const { redis } = await import("@carbon/kv");
    const current = await redis.get(CHAIN_KEY);
    return current === null || current === String(bookedFor);
  } catch {
    return true; // Redis down: keep scheduling. A transient fork is bounded and harmless —
  } // the claim's compare-and-set means a fork cannot double-fire anything.
}

export async function bookChain(wakeAt: number): Promise<void> {
  try {
    const { redis } = await import("@carbon/kv");
    await redis.set(CHAIN_KEY, String(wakeAt), "EX", CHAIN_TTL_SECONDS);
  } catch {
    // Non-fatal: the hourly backstop revives the chain.
  }
}

/** True when the chain looks dead and a wake should be sent to adopt it. */
export async function chainIsStale(now: Date): Promise<boolean> {
  try {
    const { redis } = await import("@carbon/kv");
    const current = await redis.get(CHAIN_KEY);
    if (current === null) return true;
    return Number(current) < now.getTime() - BACKSTOP_STALE_MS;
  } catch {
    return true;
  }
}
