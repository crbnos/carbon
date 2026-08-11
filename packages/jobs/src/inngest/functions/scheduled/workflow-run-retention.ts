import { datetime } from "@carbon/utils";
import { sql } from "kysely";
import type { JobDatabase } from "../../../db";
import { getJobDatabaseClient } from "../../../db";
import { INTERRUPTED } from "../../../workflows/engine/ledger";
import { compactForLog } from "../../../workflows/retention";
import { inngest } from "../../client";

// Three tiers: full step detail for a week, a summary for a month, run headers
// for a quarter. Pass order: reap → purge-headers → compact → drop-detail.
// Compact runs BEFORE deleting their steps so compactedAt is always set first.
const STALE_RUN_HOURS = 24;
const FULL_DETAIL_DAYS = 7;
const COMPACT_DETAIL_DAYS = 30;
const RUN_HEADER_DAYS = 90;
const TERMINAL = ["Succeeded", "Failed", "Blocked", "Skipped"] as const;
const BATCH = 500;
const COMPACT_BATCH = 200;
const STALE_REASON =
  "This run stopped reporting and was closed automatically after 24 hours.";

/** Blocked and Skipped runs never set completedAt, so age is measured on
 * whichever timestamp the run actually has. Matches workflowRun_retention_idx. */
const runAge = sql<string>`COALESCE("completedAt", "createdAt")`;

function cutoffDays(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function groupByCompany(
  rows: Array<{ id: string; companyId: string }>
): Map<string, string[]> {
  const byCompany = new Map<string, string[]>();
  for (const row of rows) {
    const ids = byCompany.get(row.companyId) ?? [];
    ids.push(row.id);
    byCompany.set(row.companyId, ids);
  }
  return byCompany;
}

/**
 * Oldest first, so a backlog drains instead of the same page being re-read every
 * night. `stage` narrows to the runs a pass can still make progress on: without
 * it a pass that deletes nothing re-picks the same rows forever.
 */
export function terminalRunsQuery(
  db: JobDatabase,
  cutoff: string,
  limit: number,
  stage?: "uncompacted" | "hasSteps"
) {
  let query = db
    .selectFrom("workflowRun")
    .select(["id", "companyId"])
    .where("status", "in", [...TERMINAL])
    .where(runAge, "<", cutoff)
    .orderBy(runAge, "asc")
    .limit(limit);

  if (stage === "uncompacted") query = query.where("compactedAt", "is", null);

  if (stage === "hasSteps") {
    // compactedAt is what pass 3 sets, and the run detail UI reads it to tell
    // "steps purged" from "no steps yet" — never drop steps ahead of it.
    query = query
      .where("compactedAt", "is not", null)
      .where(({ exists, selectFrom }) =>
        exists(
          selectFrom("workflowStepRun as step")
            .select(sql`1`.as("one"))
            .whereRef("step.runId", "=", "workflowRun.id")
            .whereRef("step.companyId", "=", "workflowRun.companyId")
        )
      );
  }

  return query;
}

const selectTerminalRuns = (
  db: JobDatabase,
  cutoff: string,
  limit: number,
  stage?: "uncompacted" | "hasSteps"
) => terminalRunsQuery(db, cutoff, limit, stage).execute();

/** The whole batch's interrupted steps in one statement, per company. */
async function failStaleSteps(
  db: JobDatabase,
  companyId: string,
  runIds: string[]
): Promise<void> {
  await db
    .updateTable("workflowStepRun")
    .set({
      status: "Failed",
      error: INTERRUPTED,
      completedAt: datetime.timestamp()
    })
    .where("companyId", "=", companyId)
    .where("runId", "in", runIds)
    .where("status", "=", "Running")
    .execute();
}

/**
 * Closes the runs themselves. `durationMs` is computed in SQL per row, since each
 * has its own `startedAt` — clamped at 0 the same way `finishRun` does, and a run
 * that never started reads as 0 rather than null.
 */
async function failStaleRuns(
  db: JobDatabase,
  companyId: string,
  runIds: string[]
): Promise<void> {
  const now = datetime.timestamp();
  await db
    .updateTable("workflowRun")
    .set({
      status: "Failed",
      statusReason: null,
      error: STALE_REASON,
      completedAt: now,
      durationMs: sql<number>`GREATEST(0, EXTRACT(EPOCH FROM (${now}::timestamptz - COALESCE("startedAt", ${now}::timestamptz))) * 1000)::int`
    })
    .where("companyId", "=", companyId)
    .where("id", "in", runIds)
    .where("status", "in", ["Queued", "Running"])
    .execute();
}

/** Postgres caps a statement at 65535 parameters; this one binds four per row. */
const COMPACT_CHUNK = 500;

/** One UPDATE per chunk instead of one per row — the pool holds 5 connections. */
async function writeCompactedSteps(
  db: JobDatabase,
  companyId: string,
  rows: Array<{ id: string; input: unknown; output: unknown; detail: unknown }>,
  now: string
): Promise<void> {
  const asJson = (value: unknown) =>
    value === null ? null : JSON.stringify(compactForLog(value));

  for (let i = 0; i < rows.length; i += COMPACT_CHUNK) {
    const chunk = rows.slice(i, i + COMPACT_CHUNK);
    const values = chunk.map(
      (row) =>
        sql`(${row.id}::text, ${asJson(row.input)}::jsonb, ${asJson(row.output)}::jsonb, ${asJson(row.detail)}::jsonb)`
    );
    await sql`
      UPDATE "workflowStepRun" AS s
      SET "input" = v."input",
          "output" = v."output",
          "detail" = v."detail",
          "compactedAt" = ${now}
      FROM (VALUES ${sql.join(values)}) AS v("id", "input", "output", "detail")
      WHERE s."id" = v."id" AND s."companyId" = ${companyId}
    `.execute(db);
  }
}

export const workflowRunRetentionFunction = inngest.createFunction(
  { id: "workflow-run-retention", retries: 2 },
  { cron: "0 4 * * *" },
  async ({ step, logger }) => {
    const db = getJobDatabaseClient(5);

    // 1. A run whose function died without reaching "finish" sits in Running
    // forever: permanently in flight in the UI, and invisible to every pass
    // below, which all require a terminal status.
    const reaped = await step.run("reap-stale-runs", async () => {
      const cutoff = new Date(
        Date.now() - STALE_RUN_HOURS * 60 * 60 * 1000
      ).toISOString();
      const stale = await db
        .selectFrom("workflowRun")
        .select(["id", "companyId"])
        .where("status", "in", ["Queued", "Running"])
        .where("createdAt", "<", cutoff)
        .limit(BATCH)
        .execute();

      // Two statements per company, not two per run: at BATCH=500 the per-run
      // form is ~1,000 serial round trips inside one Inngest step.
      for (const [companyId, ids] of groupByCompany(stale)) {
        await failStaleSteps(db, companyId, ids);
        await failStaleRuns(db, companyId, ids);
      }
      if (stale.length === BATCH) {
        logger.info("workflow-run-retention: more stale runs remain", {
          batch: BATCH
        });
      }
      return stale.length;
    });

    // 2. Headers last 90 days. Step rows cascade on the runId FK.
    const purgedRuns = await step.run("purge-run-headers", async () => {
      const rows = await selectTerminalRuns(
        db,
        cutoffDays(RUN_HEADER_DAYS),
        BATCH
      );
      let deleted = 0;
      for (const [companyId, ids] of groupByCompany(rows)) {
        const result = await db
          .deleteFrom("workflowRun")
          .where("companyId", "=", companyId)
          .where("id", "in", ids)
          .executeTakeFirst();
        deleted += Number(result.numDeletedRows ?? 0);
      }
      if (rows.length === BATCH) {
        logger.info("workflow-run-retention: more run headers remain", {
          batch: BATCH
        });
      }
      return deleted;
    });

    // 3. Full fidelity for a week, then a readable summary. Compact BEFORE
    // deleting so compactedAt is always set before step rows are removed.
    const compacted = await step.run("compact-step-payloads", async () => {
      const rows = await selectTerminalRuns(
        db,
        cutoffDays(FULL_DETAIL_DAYS),
        COMPACT_BATCH,
        "uncompacted"
      );
      const now = datetime.timestamp();
      let stepCount = 0;

      for (const [companyId, ids] of groupByCompany(rows)) {
        const stepRows = await db
          .selectFrom("workflowStepRun")
          .select(["id", "input", "output", "detail"])
          .where("companyId", "=", companyId)
          .where("runId", "in", ids)
          .execute();

        await writeCompactedSteps(db, companyId, stepRows, now);
        stepCount += stepRows.length;

        await db
          .updateTable("workflowRun")
          .set({ compactedAt: now })
          .where("companyId", "=", companyId)
          .where("id", "in", ids)
          .execute();
      }

      if (rows.length === COMPACT_BATCH) {
        logger.info("workflow-run-retention: more runs await compaction", {
          batch: COMPACT_BATCH
        });
      }
      return { runs: rows.length, steps: stepCount };
    });

    // 4. Step detail lasts 30 days; the header outlives it. The select requires
    // compactedAt and surviving step rows, so a run leaves this pass's candidate
    // set the moment its steps are gone — pass 4 advances like the others.
    const droppedSteps = await step.run("drop-step-detail", async () => {
      const rows = await selectTerminalRuns(
        db,
        cutoffDays(COMPACT_DETAIL_DAYS),
        BATCH,
        "hasSteps"
      );
      let deleted = 0;
      for (const [companyId, ids] of groupByCompany(rows)) {
        const result = await db
          .deleteFrom("workflowStepRun")
          .where("companyId", "=", companyId)
          .where("runId", "in", ids)
          .executeTakeFirst();
        deleted += Number(result.numDeletedRows ?? 0);
      }
      if (rows.length === BATCH) {
        logger.info("workflow-run-retention: more step detail remains", {
          batch: BATCH
        });
      }
      return deleted;
    });

    return { reaped, purgedRuns, compacted, droppedSteps };
  }
);
