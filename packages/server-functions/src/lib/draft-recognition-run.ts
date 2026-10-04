// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyTx } from "@carbon/database/client";
import { sql } from "kysely";

/**
 * Keeps Draft revenue recognition runs in step with a Planned schedule row a
 * document is about to delete or shrink. A run line copies its row's amount
 * when the run is proposed and posting uses that copy, so a credit memo that
 * trimmed a held deferral left the run recognizing the old amount, and a void
 * or memo that deleted one tripped the line's ON DELETE RESTRICT foreign key.
 * Only a Draft run can hold a Planned row (posting flips both), so this never
 * touches a posted run. A run left with no lines is deleted — it could not
 * post. Call it in the document's transaction, BEFORE the schedule write.
 */
export async function syncDraftRecognitionRuns(
  trx: KyselyTx,
  args: {
    companyId: string;
    userId: string;
    deletedScheduleIds?: string[];
    reduced?: { id: string; amount: number }[];
  }
): Promise<void> {
  const { companyId, userId, deletedScheduleIds = [], reduced = [] } = args;

  if (deletedScheduleIds.length > 0) {
    const released = await trx
      .deleteFrom("revenueRecognitionRunLine")
      .where("companyId", "=", companyId)
      .where("scheduleId", "in", deletedScheduleIds)
      .returning("runId")
      .execute();
    const runIds = [...new Set(released.map((line) => line.runId))];
    if (runIds.length > 0) {
      await trx
        .deleteFrom("revenueRecognitionRun")
        .where("companyId", "=", companyId)
        .where("status", "=", "Draft")
        .where("id", "in", runIds)
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom("revenueRecognitionRunLine as l")
                .select("l.id")
                .whereRef("l.runId", "=", "revenueRecognitionRun.id")
                .where("l.companyId", "=", companyId)
            )
          )
        )
        .execute();
    }
  }

  if (reduced.length > 0) {
    await trx
      .updateTable("revenueRecognitionRunLine")
      .set({
        amount: sql<number>`CASE "scheduleId" ${sql.join(
          reduced.map(
            ({ id, amount }) => sql`WHEN ${id} THEN ${amount}::numeric`
          ),
          sql` `
        )} END`,
        updatedBy: userId
      })
      .where("companyId", "=", companyId)
      .where(
        "scheduleId",
        "in",
        reduced.map(({ id }) => id)
      )
      .execute();
  }
}
