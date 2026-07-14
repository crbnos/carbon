import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getSalesOrderLine } from "~/modules/sales";
import { path } from "~/utils/path";

const logger = getLogger("erp", "orderid-lineid-shipment");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { orderId, lineId } = params;
  if (!orderId || !lineId) {
    throw new Error("Invalid orderId or lineId");
  }

  const { companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const serviceRole = getCarbonServiceRole();
  const salesOrderLine = await getSalesOrderLine(serviceRole, lineId);

  if (salesOrderLine.error) {
    throw redirect(
      path.to.salesOrderLine(orderId, lineId),
      await flash(
        request,
        error(salesOrderLine.error, "Failed to get sales order line")
      )
    );
  }

  if (companyId !== salesOrderLine.data.companyId) {
    throw redirect(
      path.to.salesOrderLine(orderId, lineId),
      await flash(
        request,
        error("Company does not match", "Failed to get sales order line")
      )
    );
  }

  const salesOrderShipment = await serviceRole.functions.invoke<{
    id: string;
  }>("create", {
    body: {
      type: "shipmentFromSalesOrderLine",
      locationId: salesOrderLine.data.locationId,
      salesOrderLineId: lineId,
      companyId,
      userId
    }
  });

  if (!salesOrderShipment.data || salesOrderShipment.error) {
    logger.error(salesOrderShipment.error);
    throw redirect(
      path.to.salesOrderLine(orderId, lineId),
      await flash(
        request,
        error(salesOrderShipment.error, "Failed to create shipment")
      )
    );
  }

  throw redirect(path.to.shipmentDetails(salesOrderShipment.data.id));
}
