import z from "npm:zod@^3.24.1";
import { getFunctionLogger } from "../lib/logging.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { requirePermissions } from "../lib/supabase.ts";
import type { PostReimbursementArgs } from "./post-reimbursement-transaction.ts";

const logger = getFunctionLogger("post-reimbursement");
const payloadValidator = z.object({
  type: z.enum(["post", "void"]).default("post"),
  reimbursementId: z.string(),
  userId: z.string(),
  companyId: z.string(),
});

// Both callers are the ERP's own Post/Void action routes. The Ramp sync creates
// a Draft reimbursement and never posts, so a human's click is what reaches
// `type: "post"`. `requirePermissions` proves the CALLER may act in
// `companyId`; it proves nothing about `reimbursementId`, which comes straight
// off a URL — so the transaction re-reads the record under `companyId` and a
// foreign id fails as "Reimbursement not found" rather than posting
// cross-tenant.
export async function handlePostReimbursement(
  req: Request,
  postTransaction: (
    args: PostReimbursementArgs,
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
