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

    // A contract cancellation credit released Planned deferral rows when it
    // posted; reversing its journal would not bring them back, and the
    // cancellation is irreversible once its memo has posted.
    if (type === "void") {
      const memo = await db
        .selectFrom("memo")
        .select("customerContractId")
        .where("id", "=", memoId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (memo?.customerContractId) {
        throw new ServerFnError(
          "A contract cancellation credit cannot be voided",
          400
        );
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
