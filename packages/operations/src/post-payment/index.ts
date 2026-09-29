import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { datetime, getCompanyTimeZone } from "@carbon/database/datetime";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import { z } from "zod";
import {
  assertOperationPermissions,
  callerContext,
  type OperationContext,
  serviceRoleClient
} from "../context";
import { runOperation } from "../result";
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

/**
 * `postPayment` for app code that holds a Supabase client: a service-role client
 * runs it as the system, any other client is permission-checked (`callerContext`).
 */
export async function postPaymentAs(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  input: z.input<typeof postPaymentInput> & {
    companyId: string;
    userId: string;
  }
) {
  const { companyId, userId } = input;
  return postPayment(
    await callerContext(client, { db, companyId, userId }),
    input
  );
}

/** Posts or voids a payment: settlements, funding and its journal, atomically. */
export function postPayment(
  ctx: OperationContext,
  input: z.input<typeof postPaymentInput>
) {
  return runOperation("post-payment", async () => {
    const { type, paymentId, fee } = postPaymentInput.parse(input);
    const { db, companyId, userId } = ctx;
    await assertOperationPermissions(ctx, { update: "invoicing" });
    const client = await serviceRoleClient();
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
  });
}
