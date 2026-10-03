// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCompanyTimeZone } from "@carbon/database";
import { datetime } from "@carbon/utils";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { postPaymentTransaction } from "./post-payment-transaction";

export const postPaymentInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  paymentId: z.string(),
  // A fee withheld by a payment processor before the cash reached the bank
  // (e.g. Stripe Connect's per-charge commission). The caller resolves the
  // account (an integration override or the company's service-charge
  // default) — this operation stays payment-processor-agnostic.
  fee: z
    .object({
      amount: z.number().positive(),
      accountId: z.string(),
      description: z.string().optional()
    })
    .optional()
});

/** Posts or voids a payment: settlements, funding and its journal, atomically. */
const postPayment = defineServerFn({
  name: "post-payment",
  input: postPaymentInput,
  permissions: { update: "invoicing" },
  async run(ctx, { type, paymentId, fee }) {
    const { db, companyId, userId } = ctx;
    const today = datetime
      .today(await getCompanyTimeZone(db, companyId))
      .toString();

    const result = await postPaymentTransaction(db, {
      type,
      paymentId,
      companyId,
      userId,
      today,
      fee
    });
    return { success: true, ...result };
  }
});

export default postPayment;
