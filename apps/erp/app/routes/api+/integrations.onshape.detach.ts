import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

/**
 * Remove the Onshape link from an item. The item keeps everything it has
 * (model, documents, fields); Carbon just stops treating Onshape as the owner
 * of its identity fields, and the panel shows the part as unlinked again.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const itemId = String(formData.get("itemId") ?? "");
  if (!itemId) {
    return data({ error: "itemId is required" }, { status: 400 });
  }

  const removed = await getCarbonServiceRole()
    .from("externalIntegrationMapping")
    .delete()
    .eq("companyId", companyId)
    .eq("integration", "onshape")
    .eq("entityType", "item")
    .eq("entityId", itemId);

  if (removed.error) {
    return data({ error: "Failed to detach" }, { status: 500 });
  }

  return data({ ok: true });
}
