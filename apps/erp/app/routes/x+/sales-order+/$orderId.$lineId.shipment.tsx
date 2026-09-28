import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { createSalesOrderLineShipment } from "~/modules/inventory/inventory.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { orderId, lineId } = params;
  if (!orderId || !lineId) {
    throw new Error("Invalid orderId or lineId");
  }

  const { companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  // Shared with the inventory_createSalesOrderLineShipment tool.
  const result = await createSalesOrderLineShipment({
    salesOrderLineId: lineId,
    companyId,
    userId
  });

  if (result.error) {
    throw redirect(
      path.to.salesOrderLine(orderId, lineId),
      await flash(
        request,
        error(result.error.cause ?? null, result.error.flash)
      )
    );
  }

  throw redirect(path.to.shipmentDetails(result.data.id));
}
