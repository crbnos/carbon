import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import {
  errorResponse,
  getUserIdFromRequest,
  jsonResponse,
  requireCompanyOwner
} from "../lib/company-template.ts";
import { corsHeaders } from "../lib/headers.ts";
import { sendInngestEvent } from "../lib/inngest.ts";
import { requirePermissions } from "../lib/supabase.ts";

/**
 * Thin auth boundary for reverting an import run. Validates the caller is
 * the company owner, then hands the deletion to the `carbon/company-revert`
 * inngest job (which deletes in reverse-topological order via the shared
 * table catalog). The pending-import card clears once the ledger is gone.
 */
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { companyId, importRunId, userId: bodyUserId } = await req.json();

    if (!companyId) throw new Error("Payload is missing companyId");
    if (!importRunId) throw new Error("Payload is missing importRunId");

    const userId = bodyUserId ?? getUserIdFromRequest(req);
    if (!userId) throw new Error("Could not determine user");

    const client = await requirePermissions(req, companyId, userId, {
      update: "settings"
    });
    await requireCompanyOwner(client, companyId, userId);

    await sendInngestEvent("carbon/company-revert", {
      companyId,
      importRunId
    });

    return jsonResponse({ success: true }, 202, corsHeaders);
  } catch (err) {
    return errorResponse(err, 400, corsHeaders);
  }
});
