import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import {
  TEMPLATE_INTEGRATION,
  errorResponse,
  getUserIdFromRequest,
  jsonResponse,
  requireCompanyOwner
} from "../lib/company-template.ts";
import { corsHeaders } from "../lib/headers.ts";
import { requirePermissions } from "../lib/supabase.ts";

/**
 * Commit an import run: the imported rows stay, and the revert ledger
 * (externalIntegrationMapping rows tagged with the run id) is deleted so a
 * new import can start.
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

    const deleted = await client
      .from("externalIntegrationMapping")
      .delete({ count: "exact" })
      .eq("integration", TEMPLATE_INTEGRATION)
      .eq("companyId", companyId)
      .filter("metadata->>importRunId", "eq", importRunId);
    if (deleted.error) throw new Error(deleted.error.message);

    return jsonResponse(
      { success: true, deleted: deleted.count ?? 0 },
      200,
      corsHeaders
    );
  } catch (err) {
    return errorResponse(err, 400, corsHeaders);
  }
});
