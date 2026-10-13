// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import { generateTimeAndMaterialsItems } from "../lib/project-posting";

export const generateContractBillableItemsInput = z.object({
  customerContractLineId: z.string(),
  /** `YYYY-MM-DD` in the company's timezone: rows posted on or before it bill. */
  through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export type GenerateContractBillableItemsResult = {
  /** The number of billable items written. */
  generated: number;
};

/**
 * The backfill of one Time & Materials line: billable items for the ledger
 * rows of its billing element subtree posted on or before `through` that have
 * none yet. A second call writes nothing. A Cost Plus line is refused: its
 * items come from the commercial generator, which the ERP calls.
 * Plan: .ai/plans/2026-10-09-project-billing-phase-4a.md (Task 9).
 */
const generateContractBillableItems = defineServerFn({
  name: "generate-contract-billable-items",
  input: generateContractBillableItemsInput,
  permissions: { update: "sales" },
  async run(
    { db, companyId, userId },
    { customerContractLineId, through }
  ): Promise<GenerateContractBillableItemsResult> {
    return db.transaction().execute(async (trx) => {
      const line = await trx
        .selectFrom("customerContractLine")
        .select(["id", "billingMethod"])
        .where("id", "=", customerContractLineId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!line) throw new NotFoundError("Contract line not found");
      if (line.billingMethod === "Cost Plus") {
        throw new InvalidInputError(
          "Cost Plus items come from the Project Revenue feature"
        );
      }
      if (line.billingMethod !== "Time & Materials") {
        throw new InvalidInputError(
          "Only a Time & Materials line has billable items"
        );
      }
      const generated = await generateTimeAndMaterialsItems(trx, {
        companyId,
        userId,
        customerContractLineId,
        through
      });
      return { generated };
    });
  }
});

export default generateContractBillableItems;
