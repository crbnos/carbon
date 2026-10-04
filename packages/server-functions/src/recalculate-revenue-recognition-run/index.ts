// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Rebuilds a Draft revenue recognition run from the schedule as it is now. A
// Draft is a snapshot: rows that fell due after it was proposed are not in it,
// and posting refuses it as out of date. Recalculating keeps the run's id and
// number, releases every row it held, and claims what is due by its period end
// again — the same rows a fresh proposal would, through the same synthesizers.

import { datetime, equals } from "@carbon/utils";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import {
  claimScheduleRows,
  RUN_ROW_SYNTHESIZERS,
  type RunProposalContext,
  selectDueScheduleRows
} from "../propose-revenue-recognition-run";

export const recalculateRevenueRecognitionRunInput = z.object({
  runId: z.string().min(1)
});

export type RunRecalculation = {
  runId: string;
  lineCount: number;
  /** False when the run already held exactly what is due. */
  changed: boolean;
  /** Nothing is due any more, so the run was deleted. */
  deleted: boolean;
};

const recalculateRevenueRecognitionRun = defineServerFn({
  name: "recalculate-revenue-recognition-run",
  input: recalculateRevenueRecognitionRunInput,
  permissions: { update: "accounting" },
  async run({ db, companyId, userId }, { runId }): Promise<RunRecalculation> {
    return db.transaction().execute(async (trx) => {
      const run = await trx
        .selectFrom("revenueRecognitionRun")
        .select(["id", "runId", "status", "periodEnd"])
        .where("id", "=", runId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!run) throw new NotFoundError("Revenue recognition run not found");
      if (run.status !== "Draft") {
        throw new InvalidInputError(
          `Revenue recognition run ${run.runId} is ${run.status}; only a draft can be recalculated`
        );
      }

      const ctx: RunProposalContext = {
        companyId,
        periodEnd: String(run.periodEnd),
        userId
      };

      // Synthesizers first: they take the company's proposal lock, so a
      // concurrent proposal cannot claim a row between the release and the
      // claim below.
      for (const synthesize of RUN_ROW_SYNTHESIZERS) {
        await synthesize(trx, ctx);
      }

      const before = await trx
        .selectFrom("revenueRecognitionRunLine")
        .select(["id", "scheduleId", "amount"])
        .where("runId", "=", run.id)
        .where("companyId", "=", companyId)
        .execute();
      if (before.length > 0) {
        await trx
          .updateTable("revenueRecognitionSchedule")
          .set({ runLineId: null, updatedBy: userId })
          .where("companyId", "=", companyId)
          .where(
            "runLineId",
            "in",
            before.map((line) => line.id)
          )
          .execute();
        await trx
          .deleteFrom("revenueRecognitionRunLine")
          .where("runId", "=", run.id)
          .where("companyId", "=", companyId)
          .execute();
      }

      const due = await selectDueScheduleRows(trx, ctx);
      const held = new Map(
        before.map((line) => [line.scheduleId, Number(line.amount)])
      );
      const changed =
        due.length !== before.length ||
        due.some(
          (row) =>
            !held.has(row.id) || !equals(held.get(row.id)!, Number(row.amount))
        );

      if (due.length === 0) {
        await trx
          .deleteFrom("revenueRecognitionRun")
          .where("id", "=", run.id)
          .where("companyId", "=", companyId)
          .execute();
        return { runId: run.runId, lineCount: 0, changed, deleted: true };
      }

      await claimScheduleRows(trx, run.id, due, ctx);
      await trx
        .updateTable("revenueRecognitionRun")
        .set({ updatedBy: userId, updatedAt: datetime.timestamp() })
        .where("id", "=", run.id)
        .where("companyId", "=", companyId)
        .execute();

      return {
        runId: run.runId,
        lineCount: due.length,
        changed,
        deleted: false
      };
    });
  }
});

export default recalculateRevenueRecognitionRun;
