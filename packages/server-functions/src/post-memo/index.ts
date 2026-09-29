import { datetime, getCompanyTimeZone } from "@carbon/database/datetime";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { postMemoTransaction } from "./post-memo-transaction";

export const postMemoInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  memoId: z.string()
});

/** Posts or voids a credit/debit memo and its journal, atomically. */
export const postMemo = defineServerFn({
  name: "post-memo",
  input: postMemoInput,
  permissions: { update: "invoicing" },
  async run(ctx, { type, memoId }) {
    const { db, companyId, userId } = ctx;
    const client = await ctx.supabase();
    const today = datetime
      .today(await getCompanyTimeZone(client, companyId))
      .toString();

    const result = await postMemoTransaction(db, {
      type,
      memoId,
      userId,
      companyId,
      today,
      client
    });
    return { success: true, ...result };
  }
});
