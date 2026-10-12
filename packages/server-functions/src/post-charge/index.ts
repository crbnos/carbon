// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { postChargeTransaction } from "./post-charge-transaction";

export const postChargeInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  chargeId: z.string()
});

/**
 * Posts or voids a charge and its journal, atomically. The transaction re-reads
 * the record under companyId, so a foreign id fails as "not found".
 */
const postCharge = defineServerFn({
  name: "post-charge",
  input: postChargeInput,
  permissions: { update: "invoicing" },
  async run(ctx, { type, chargeId }) {
    const { db, companyId, userId } = ctx;
    const result = await postChargeTransaction(db, {
      type,
      chargeId,
      companyId,
      userId
    });
    return { success: true, ...result };
  }
});

export default postCharge;
