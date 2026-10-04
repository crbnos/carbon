// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Draft revenue recognition runs for the live-database regressions, on top of
// `paymentFixture`'s company.
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { claimScheduleRows } from ".";

/** A Draft run for `periodEnd` holding exactly `scheduleIds`, claimed the way
 *  a proposal claims them. Returns the run's id. */
export async function holdInDraftRun(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  scheduleIds: string[],
  periodEnd = "2026-09-30"
): Promise<string> {
  const id = `${companyId}-rr-run`;
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("revenueRecognitionRun")
      .values({
        id,
        runId: "RR-TEST",
        periodEnd,
        status: "Draft",
        companyId,
        createdBy: "system"
      })
      .execute();
    const rows = await trx
      .selectFrom("revenueRecognitionSchedule")
      .select(["id", "amount"])
      .where("companyId", "=", companyId)
      .where("id", "in", scheduleIds)
      .execute();
    await claimScheduleRows(trx, id, rows, {
      companyId,
      periodEnd,
      userId: "system"
    });
  });
  return id;
}

/** The run lines' ON DELETE RESTRICT to the schedule can fire inside the
 *  company cascade, so drop the runs before `cleanup()`. */
export async function dropRecognitionRuns(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<void> {
  await db
    .deleteFrom("revenueRecognitionRun")
    .where("companyId", "=", companyId)
    .execute();
}
