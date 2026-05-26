import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { deleteShipmentLine } from "~/modules/inventory/inventory.service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const lineDelete = await deleteShipmentLine(id);

  if (lineDelete.error) {
    return {
      success: false,
      message: lineDelete.error.message
    };
  }

  return {
    success: true,
    message: "Shipment line deleted successfully"
  };
}
