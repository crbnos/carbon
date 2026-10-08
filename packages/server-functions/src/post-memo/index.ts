// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCompanyTimeZone } from "@carbon/database";
import { datetime } from "@carbon/utils";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { ServerFnError } from "../errors";
import { postMemoTransaction } from "./post-memo-transaction";

export const postMemoInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  memoId: z.string()
});

/** Posts or voids a credit/debit memo and its journal, atomically. */
const postMemo = defineServerFn({
  name: "post-memo",
  input: postMemoInput,
  permissions: { update: "invoicing" },
  async run(ctx, { type, memoId }) {
    const { db, companyId, userId } = ctx;
    const today = datetime
      .today(await getCompanyTimeZone(db, companyId))
      .toString();

    // A contract cancellation credit is irreversible once its memo has
    // posted: reversing its journal would not restore the contract.
    if (type === "void") {
      const memo = await db
        .selectFrom("memo")
        .select(["customerContractId", "rentalAgreementId"])
        .where("id", "=", memoId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (memo?.customerContractId) {
        throw new ServerFnError(
          "A contract cancellation credit cannot be voided",
          400
        );
      }
      // A rental early-return credit can be voided while its Deferral rows are
      // all still Planned and unclaimed: the void deletes them and returns the
      // periods to Pending. Once a run has recognized one, reversing the memo
      // journal would leave that recognition standing.
      if (memo?.rentalAgreementId) {
        const recognized = await db
          .selectFrom("revenueRecognitionSchedule")
          .select("id")
          .where("companyId", "=", companyId)
          .where("memoId", "=", memoId)
          .where((eb) =>
            eb.or([
              eb("status", "=", "Posted"),
              eb("runLineId", "is not", null)
            ])
          )
          .limit(1)
          .executeTakeFirst();
        if (recognized) {
          throw new ServerFnError(
            "This rental credit is already part of a revenue recognition run; reverse or delete the run before voiding it",
            400
          );
        }
      }
    }

    const result = await postMemoTransaction(db, {
      type,
      memoId,
      userId,
      companyId,
      today
    });
    return { success: true, ...result };
  }
});

export default postMemo;
