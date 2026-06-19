import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import {
  EXPORTS_PREFIX,
  TEMPLATE_INTEGRATION,
  errorResponse,
  jsonResponse,
  requireCompanyOwner
} from "../lib/company-template.ts";
import { corsHeaders } from "../lib/headers.ts";
import { sendInngestEvent } from "../lib/inngest.ts";
import { requirePermissions } from "../lib/supabase.ts";

/**
 * Thin auth boundary for company template imports. Validates the caller,
 * the artifact and that no other import run is pending, then hands the
 * heavy lifting to the `carbon/company-import` inngest job.
 *
 * The import is two-phase: the job inserts rows alongside an
 * `externalIntegrationMapping` ledger (integration = 'company-template');
 * the run is then committed via `finalize-import` or undone via
 * `revert-import`.
 */
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { companyId, userId, filePath, mode } = await req.json();

    if (!companyId) throw new Error("Payload is missing companyId");
    if (!userId) throw new Error("Payload is missing userId");
    if (!filePath) throw new Error("Payload is missing filePath");
    if (mode && !["preserve", "reseed"].includes(mode)) {
      throw new Error("mode must be 'preserve' or 'reseed'");
    }
    if (!filePath.startsWith(`${EXPORTS_PREFIX}/`)) {
      throw new Error(`filePath must be inside ${EXPORTS_PREFIX}/`);
    }

    const client = await requirePermissions(req, companyId, userId, {
      update: "settings"
    });
    await requireCompanyOwner(client, companyId, userId);

    const file = await client.storage
      .from(companyId)
      .createSignedUrl(filePath, 60);
    if (file.error) {
      return errorResponse(
        new Error(`Artifact not found: ${filePath}`),
        404,
        corsHeaders
      );
    }

    const pending = await client
      .from("externalIntegrationMapping")
      .select("id", { count: "exact", head: true })
      .eq("integration", TEMPLATE_INTEGRATION)
      .eq("companyId", companyId);
    if ((pending.count ?? 0) > 0) {
      return errorResponse(
        new Error(
          "A pending import already exists — finalize or revert it first"
        ),
        409,
        corsHeaders
      );
    }

    // Reseed populates a brand-new company from a template; it can't layer
    // onto a company that's already been set up (the seeded singletons and
    // reference data would collide). `accountDefault` is the canonical
    // "this company is configured" marker, written by seed-company.
    if ((mode ?? "reseed") === "reseed") {
      const seeded = await client
        .from("accountDefault")
        .select("companyId", { count: "exact", head: true })
        .eq("companyId", companyId);
      if ((seeded.count ?? 0) > 0) {
        return errorResponse(
          new Error(
            "Reseed requires a freshly created company. This company has " +
              "already been set up — create a new company to import a template, " +
              "or use preserve mode to restore into the source company."
          ),
          409,
          corsHeaders
        );
      }
    }

    const importRunId = crypto.randomUUID();

    await sendInngestEvent("carbon/company-import", {
      companyId,
      userId,
      filePath,
      mode: mode ?? "reseed",
      importRunId
    });

    return jsonResponse({ success: true, importRunId }, 202, corsHeaders);
  } catch (err) {
    return errorResponse(err, 400, corsHeaders);
  }
});
