import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { ProviderID } from "@carbon/ee/accounting";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

const logger = getLogger("erp", "integrations-rillet-import-contacts");

export const config = {
  runtime: "nodejs"
};

/**
 * POST — start the Rillet contact import (the "Import customers & vendors"
 * action on the integration settings page). Fire-and-forget: the
 * `rillet-import-contacts` job does the work, and its per-record outcome is
 * the ledger, visible in Sync Activity.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const integration = await client
    .from("companyIntegration")
    .select("active")
    .eq("companyId", companyId)
    .eq("id", ProviderID.RILLET)
    .single();

  if (integration.error || !integration.data?.active) {
    return data(
      { error: "Rillet integration not found or inactive" },
      { status: 400 }
    );
  }

  try {
    await trigger("rillet-import-contacts", {
      companyId,
      entityTypes: { customers: true, vendors: true }
    });

    return data({
      success: true,
      message: "Customer and vendor import started"
    });
  } catch (error) {
    logger.error("Failed to start Rillet contact import", { error });
    return data(
      { error: "Failed to start customer and vendor import" },
      { status: 500 }
    );
  }
}
