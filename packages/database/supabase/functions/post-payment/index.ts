import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import z from "npm:zod@^4.5.4";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { datetime, getCompanyTimeZone } from "../lib/datetime.ts";
import { getFunctionLogger } from "../lib/logging.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";

import { postPaymentTransaction } from "./post-payment-transaction.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);
const logger = getFunctionLogger("post-payment");

const payloadValidator = z.object({
  type: z.enum(["post", "void"]).default("post"),
  paymentId: z.string(),
  userId: z.string(),
  companyId: z.string(),
  // A fee withheld by a payment processor before the cash reached the bank
  // (e.g. Stripe Connect's per-charge commission). The caller resolves the
  // account (an integration override or the company's service-charge
  // default) — this function stays payment-processor-agnostic.
  fee: z
    .object({
      amount: z.number().positive(),
      accountId: z.string(),
      description: z.string().optional(),
    })
    .optional(),
});

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  const payload = await req.json();

  try {
    const { type, paymentId, userId, companyId, fee } = payloadValidator.parse(
      payload,
    );

    logger.info({ type, paymentId, userId, companyId });

    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId,
    );
    const today = datetime.today(await getCompanyTimeZone(client, companyId))
      .toString();

    const result = await postPaymentTransaction(db, {
      type,
      paymentId,
      companyId,
      userId,
      today,
      client,
      fee,
    });
    return jsonResponse({ success: true, ...result });
  } catch (err) {
    return errorResponse(err, 500);
  }
});
