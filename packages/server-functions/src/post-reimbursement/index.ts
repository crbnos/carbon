import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { postReimbursementTransaction } from "./post-reimbursement-transaction";

export const postReimbursementInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  reimbursementId: z.string()
});

/**
 * Posts or voids a reimbursement and its journal, atomically. The transaction re-reads
 * the record under companyId, so a foreign id fails as "not found".
 */
export const postReimbursement = defineServerFn({
  name: "post-reimbursement",
  input: postReimbursementInput,
  permissions: { update: "invoicing" },
  async run(ctx, { type, reimbursementId }) {
    const { db, companyId, userId } = ctx;
    const result = await postReimbursementTransaction(db, {
      type,
      reimbursementId,
      companyId,
      userId
    });
    return { success: true, ...result };
  }
});
