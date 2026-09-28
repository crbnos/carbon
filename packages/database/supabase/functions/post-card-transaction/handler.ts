import z from "npm:zod@^3.24.1";
import { getFunctionLogger } from "../lib/logging.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { requirePermissions } from "../lib/supabase.ts";
import type { PostCardTransactionArgs } from "./post-card-transaction-transaction.ts";

const logger = getFunctionLogger("post-card-transaction");
const payloadValidator = z.object({
  type: z.enum(["post", "void"]).default("post"),
  cardTransactionId: z.string(),
  userId: z.string(),
  companyId: z.string(),
});

export async function handlePostCardTransaction(
  req: Request,
  postTransaction: (
    args: PostCardTransactionArgs,
  ) => Promise<{ journalId: string | null }>,
): Promise<Response> {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  try {
    const args = payloadValidator.parse(await req.json());
    logger.info(args);
    await requirePermissions(req, args.companyId, args.userId, {
      update: "invoicing",
    });
    const result = await postTransaction(args);
    return jsonResponse({ success: true, ...result });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
