import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import z from "npm:zod@^4.5.4";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { datetime, getCompanyTimeZone } from "../lib/datetime.ts";
import { getFunctionLogger } from "../lib/logging.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";

import { postMemoTransaction } from "./post-memo-transaction.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);
const logger = getFunctionLogger("post-memo");

const payloadValidator = z.object({
  type: z.enum(["post", "void"]).default("post"),
  memoId: z.string(),
  userId: z.string(),
  companyId: z.string(),
});

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  const payload = await req.json();

  try {
    const { type, memoId, userId, companyId } = payloadValidator.parse(payload);

    logger.info({ type, memoId, userId, companyId });

    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId,
    );
    const today = datetime.today(await getCompanyTimeZone(client, companyId))
      .toString();

    const result = await postMemoTransaction(db, {
      type,
      memoId,
      userId,
      companyId,
      today,
      client,
    });
    return jsonResponse({ success: true, ...result });
  } catch (err) {
    return errorResponse(err, 500);
  }
});
