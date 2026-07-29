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
