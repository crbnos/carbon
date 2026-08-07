import { datetime } from "@carbon/utils";
import { sql } from "kysely";
import type { JobDatabase } from "../../../db";
import { getJobDatabaseClient } from "../../../db";
import { failInterruptedSteps } from "../../../workflows/engine/ledger";
import { failCrashedRun } from "../../../workflows/engine/log";
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

async function selectTerminalRuns(
  db: JobDatabase,
  cutoff: string,
  limit: number,
  onlyUncompacted = false
) {
  let query = db
    .selectFrom("workflowRun")
    .select(["id", "companyId"])
    .where("status", "in", [...TERMINAL])
    .where(runAge, "<", cutoff)
    .limit(limit);
  if (onlyUncompacted) query = query.where("compactedAt", "is", null);
  return query.execute();
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

      for (const run of stale) {
        await failInterruptedSteps(db, run.id, run.companyId);
        await failCrashedRun(db, run.id, run.companyId, STALE_REASON);
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
        true
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

        await Promise.all(
          stepRows.map((stepRow) =>
            db
              .updateTable("workflowStepRun")
              .set({
                input:
                  stepRow.input === null
                    ? null
                    : JSON.stringify(compactForLog(stepRow.input)),
                output:
                  stepRow.output === null
                    ? null
                    : JSON.stringify(compactForLog(stepRow.output)),
                detail:
                  stepRow.detail === null
                    ? null
                    : JSON.stringify(compactForLog(stepRow.detail)),
                compactedAt: now
              })
              .where("companyId", "=", companyId)
              .where("id", "=", stepRow.id)
              .execute()
          )
        );
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

    // 4. Step detail lasts 30 days; the header outlives it. Runs here already
    // had compactedAt set in pass 3 (either this run or a prior night).
    const droppedSteps = await step.run("drop-step-detail", async () => {
      const rows = await selectTerminalRuns(
        db,
        cutoffDays(COMPACT_DETAIL_DAYS),
        BATCH
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
