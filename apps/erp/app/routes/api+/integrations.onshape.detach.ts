import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "integrations-onshape-detach");

/**
 * Remove the Onshape panel's link from an item. The item keeps everything it
 * has (model, documents, fields); name and description become editable in
 * Carbon again, and the panel shows the part as unlinked.
 *
 * Only the `onshape-v2` link is removed, whatever the form posts. A sync
 * connection's `onshape` row is BOM-import bookkeeping that the BoM Explorer
 * reads, and it never locked anything.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const itemId = String(formData.get("itemId") ?? "");
  if (!itemId) {
    return data(
      { success: false, message: "itemId is required" },
      { status: 400 }
    );
  }

  const removed = await getCarbonServiceRole()
    .from("externalIntegrationMapping")
    .delete()
    .eq("companyId", companyId)
    .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
    .eq("entityType", "item")
    .eq("entityId", itemId)
    .select("id");

  if (removed.error) {
    logger.error("Failed to detach an item from Onshape", {
      companyId,
      itemId,
      error: removed.error
    });
    return data(
      { success: false, message: "Failed to detach from Onshape" },
      { status: 500 }
    );
  }
  if (removed.data.length === 0) {
    return data(
      { success: false, message: "This item is not linked to Onshape" },
      { status: 404 }
    );
  }

  return data({ success: true, message: "Detached from Onshape" });
}
