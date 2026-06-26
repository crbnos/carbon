import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { errorResponse, jsonResponse } from "../lib/company-backup.ts";
import { corsHeaders } from "../lib/headers.ts";
import { sendInngestEvent } from "../lib/inngest.ts";
import { requirePermissions } from "../lib/supabase.ts";

/**
 * Thin auth boundary for company backup exports. Validates the caller has
 * settings update permission, then hands the heavy lifting to the
 * `carbon/company-export` inngest job. The backup lands in the company's
 * bucket under `exports/`.
 */
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { companyId, userId, label, includeStorage } = await req.json();

    if (!companyId) throw new Error("Payload is missing companyId");
    if (!userId) throw new Error("Payload is missing userId");
    if (includeStorage && !["none", "all"].includes(includeStorage)) {
      throw new Error("includeStorage must be 'none' or 'all'");
    }

    await requirePermissions(req, companyId, userId, {
      update: "settings"
    });

    await sendInngestEvent("carbon/company-export", {
      companyId,
      userId,
      label: typeof label === "string" ? label.slice(0, 80) : undefined,
      includeStorage: includeStorage ?? "none"
    });

    return jsonResponse({ success: true }, 202, corsHeaders);
  } catch (err) {
    return errorResponse(err, 400, corsHeaders);
  }
});
