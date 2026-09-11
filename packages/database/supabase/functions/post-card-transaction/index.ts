import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import z from "npm:zod@^3.24.1";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { getFunctionLogger } from "../lib/logging.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { postCardTransactionTransaction } from "./post-card-transaction-transaction.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);
const logger = getFunctionLogger("post-card-transaction");

const payloadValidator = z.object({
  type: z.enum(["post", "void"]).default("post"),
  cardTransactionId: z.string(),
  userId: z.string(),
  companyId: z.string(),
});

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  const payload = await req.json();
  try {
    const { type, cardTransactionId, userId, companyId } = payloadValidator
      .parse(payload);
    logger.info({ type, cardTransactionId, userId, companyId });

    await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId,
    );
    const result = await postCardTransactionTransaction(db, {
      type,
      cardTransactionId,
      companyId,
      userId,
    });
    return jsonResponse({ success: true, ...result });
  } catch (err) {
    return errorResponse(err, 500);
  }
});
