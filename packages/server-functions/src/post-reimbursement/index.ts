// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
const postReimbursement = defineServerFn({
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

export default postReimbursement;
