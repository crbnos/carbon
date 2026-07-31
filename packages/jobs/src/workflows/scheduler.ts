import type { KyselyDatabase } from "@carbon/database/client";
import { redis } from "@carbon/kv";
import { findTriggerSchedule, nextRunAfter } from "@carbon/workflows";
import type { Kysely } from "kysely";
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
  activeVersionId: string;
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
        .onRef("v.id", "=", "w.activeVersionId")
        .onRef("v.companyId", "=", "w.companyId")
    )
    .select([
      "w.id",
      "w.companyId",
      "w.ownerId",
      "w.activeVersionId",
      "w.nextRunAt",
      "v.nodes"
    ])
    .where("w.active", "=", true)
    .where("w.activeVersionId", "is not", null)
    .where("w.nextRunAt", "<=", now.toISOString())
    .orderBy("w.nextRunAt", "asc")
    .limit(MAX_DUE_PER_WAKE)
    .execute();

  const futureRow = await db
    .selectFrom("workflow as w")
    .select("w.nextRunAt")
    .where("w.active", "=", true)
    .where("w.activeVersionId", "is not", null)
    .where("w.nextRunAt", ">", now.toISOString())
    .orderBy("w.nextRunAt", "asc")
    .limit(1)
    .executeTakeFirst();

  return {
    due: due
      .filter(
        (r): r is typeof r & { activeVersionId: string } =>
          r.activeVersionId !== null
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

/**
 * Writes the recomputed nextRunAt only if the row still holds the value we read. Zero rows back
 * means another wake won the race. The new value is computed from NOW, not from dueAt, so a long
 * outage can never queue a cascade of catch-up runs.
 */
export async function claimDue(
  db: Kysely<KyselyDatabase>,
  row: DueWorkflow,
  now: Date
): Promise<boolean> {
  const schedule = findTriggerSchedule(row.nodes);
  if (!schedule) {
    // Promoted version is no longer schedule-triggered — clear the due time.
    await db
      .updateTable("workflow")
      .set({ nextRunAt: null })
      .where("id", "=", row.id)
      .where("companyId", "=", row.companyId)
      .where("nextRunAt", "=", row.nextRunAt.toISOString())
      .execute();
    return false;
  }

  const recomputed = nextRunAfter(schedule, row.id, now).toISOString();
  const claimed = await db
    .updateTable("workflow")
    .set({ nextRunAt: recomputed })
    .where("id", "=", row.id)
    .where("companyId", "=", row.companyId)
    .where("nextRunAt", "=", row.nextRunAt.toISOString())
    .returning(["id"])
    .executeTakeFirst();
  return claimed !== undefined;
}

async function hasActiveRun(
  db: Kysely<KyselyDatabase>,
  workflowId: string,
  companyId: string
): Promise<boolean> {
  const row = await db
    .selectFrom("workflowRun")
    .select("id")
    .where("workflowId", "=", workflowId)
    .where("companyId", "=", companyId)
    .where("status", "in", ["Queued", "Running"])
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
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

  for (const row of due) {
    const dueAt = row.nextRunAt;
    const dueAtIso = dueAt.toISOString();

    const claimed = await claimDue(db, row, now);
    if (!claimed) continue;

    let status: "Queued" | "Skipped";
    let statusReason: string | null = null;

    if (now.getTime() - dueAt.getTime() > STALE_AFTER_MS) {
      status = "Skipped";
      statusReason = TOO_LATE;
    } else if (await hasActiveRun(db, row.id, row.companyId)) {
      status = "Skipped";
      statusReason = PREVIOUS_RUN_ACTIVE;
    } else {
      status = "Queued";
    }

    const planned: PlannedRun[] = [
      {
        workflowId: row.id,
        workflowVersionId: row.activeVersionId,
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
    const current = await redis.get(CHAIN_KEY);
    return current === null || current === String(bookedFor);
  } catch {
    return true; // Redis down: keep scheduling. A transient fork is bounded and harmless —
  } // the claim's compare-and-set means a fork cannot double-fire anything.
}

export async function bookChain(wakeAt: number): Promise<void> {
  try {
    await redis.set(CHAIN_KEY, String(wakeAt), "EX", CHAIN_TTL_SECONDS);
  } catch {
    // Non-fatal: the hourly backstop revives the chain.
  }
}

/** True when the chain looks dead and a wake should be sent to adopt it. */
export async function chainIsStale(now: Date): Promise<boolean> {
  try {
    const current = await redis.get(CHAIN_KEY);
    if (current === null) return true;
    return Number(current) < now.getTime() - BACKSTOP_STALE_MS;
  } catch {
    return true;
  }
}
