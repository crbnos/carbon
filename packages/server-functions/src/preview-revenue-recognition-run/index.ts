// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What a new revenue recognition run for `periodEnd` would claim, without
// creating it: the proposal's own synthesizers and due-row query, in a
// transaction that always rolls back. The period close checklist asks this
// instead of copying the proposal's rules, so a new synthesizer is covered the
// day it lands.

import { round } from "@carbon/utils";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import {
  RUN_ROW_SYNTHESIZERS,
  selectDueScheduleRows
} from "../propose-revenue-recognition-run";

export const previewRevenueRecognitionRunInput = z.object({
  /** `YYYY-MM-DD`, the last day of the period. */
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export type RunPreview = { count: number; amount: number };

/** Thrown at the end of the preview transaction so it never commits. */
class RollbackPreview extends Error {
  constructor(readonly preview: RunPreview) {
    super("preview rollback");
  }
}

const previewRevenueRecognitionRun = defineServerFn({
  name: "preview-revenue-recognition-run",
  input: previewRevenueRecognitionRunInput,
  permissions: { view: "accounting" },
  async run({ db, companyId, userId }, { periodEnd }): Promise<RunPreview> {
    try {
      await db.transaction().execute(async (trx) => {
        const ctx = { companyId, periodEnd, userId };
        for (const synthesize of RUN_ROW_SYNTHESIZERS) {
          await synthesize(trx, ctx);
        }
        const due = await selectDueScheduleRows(trx, ctx);
        throw new RollbackPreview({
          count: due.length,
          amount: round(due.reduce((sum, row) => sum + Number(row.amount), 0))
        });
      });
    } catch (error) {
      if (error instanceof RollbackPreview) return error.preview;
      throw error;
    }
    throw new Error("Revenue recognition preview did not roll back");
  }
});

export default previewRevenueRecognitionRun;
