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
export const postPayment = defineServerFn({
  name: "post-payment",
  input: postPaymentInput,
  permissions: { update: "invoicing" },
  async run(ctx, { type, paymentId, fee }) {
    const { db, companyId, userId } = ctx;
    const client = await ctx.supabase();
    const today = datetime
      .today(await getCompanyTimeZone(client, companyId))
      .toString();

    const result = await postPaymentTransaction(db, {
      type,
      paymentId,
      companyId,
      userId,
      today,
      client,
      fee
    });
    return { success: true, ...result };
  }
});
