import { requirePermissions } from "@carbon/auth/auth.server";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

// POST: kick off the Onshape released-asset backfill for the current company.
// Admin-only. Gated on the SAME configurable flag the job checks
// (companyIntegration.metadata.assetSyncEnabled) so it can't be run unless the
// company has turned Onshape asset sync on.
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const integration = await client
    .from("companyIntegration")
    .select("active, metadata")
    .eq("companyId", companyId)
    .eq("id", "onshape")
    .single();

  if (integration.error || !integration.data?.active) {
    return data(
      { error: "Onshape integration not found or inactive" },
      { status: 400 }
    );
  }

  const metadata = (integration.data.metadata ?? {}) as Record<string, unknown>;

  // The backfill is a LEGACY mechanism: it matches Onshape revisions to Carbon
  // items by readableIdWithRevision. Running it on a v2 company reintroduces
  // exactly the part-number join v2 exists to replace, and would attach
  // geometry to whichever revision happened to share a string.
  if (metadata.pipeline === "next") {
    return data(
      {
        error:
          "This company is on Onshape v2, which links items by id rather than by part number. The backfill matches by part number and is not available here."
      },
      { status: 400 }
    );
  }

  if (metadata.assetSyncEnabled !== true) {
    return data(
      {
        error:
          "Onshape asset sync is disabled — enable it on the Onshape integration before running a backfill"
      },
      { status: 400 }
    );
  }

  try {
    await trigger("onshape-backfill", { companyId, userId });
    return data({ success: true, message: "Onshape asset backfill started" });
  } catch (error) {
    console.error("Failed to start Onshape backfill:", error);
    return data({ error: "Failed to start Onshape backfill" }, { status: 500 });
  }
}
