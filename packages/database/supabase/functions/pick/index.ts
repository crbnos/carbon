import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^4.5.4";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { getFunctionLogger } from "../lib/logging.ts";
import { requirePermissions } from "../lib/supabase.ts";

import { corsPreflight, errorResponse } from "../lib/response.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);
const logger = getFunctionLogger("pick");

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stageJob"),
    jobId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("generateStockTransfer"),
    locationId: z.string(),
    jobIds: z.array(z.string()).optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("executePick"),
    stockTransferLineId: z.string(),
    pickedQuantity: z.number(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("completeStockTransfer"),
    stockTransferId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
]);

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;
  const payload = await req.json();

  try {
    const { type, companyId, userId } = payloadValidator.parse(payload);

    logger.info({ type, companyId, userId });

    const client = await requirePermissions(req, companyId, userId, { update: "inventory" });

    switch (type) {
      case "stageJob":
      case "generateStockTransfer":
      case "executePick":
      case "completeStockTransfer":
      default:
        return errorResponse("Invalid operation type", 400);
    }
  } catch (error) {
    logger.error("pick failed", {
      error: String((error as Error)?.stack ?? error),
    });
    return errorResponse(error, 500);
  }
});
