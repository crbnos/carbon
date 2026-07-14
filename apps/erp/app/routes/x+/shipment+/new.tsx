import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import type { ShipmentSourceDocument } from "~/modules/inventory";
import { getUserDefaults } from "~/modules/users/users.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "shipment");

export const handle: Handle = {
  breadcrumb: msg`Shipments`,
  to: path.to.shipments
};

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const formData = await request.formData();
  const sourceDocument =
    (formData.get("sourceDocument") as ShipmentSourceDocument) ?? undefined;
  const sourceDocumentId = (formData.get("sourceDocumentId") as string) ?? "";

  const defaults = await getUserDefaults(client, userId, companyId);
  const serviceRole = getCarbonServiceRole();

  switch (sourceDocument) {
    case "Sales Order":
      const salesOrderShipment = await serviceRole.functions.invoke<{
        id: string;
      }>("create", {
        body: {
          type: "shipmentFromSalesOrder",
          companyId,
          locationId: defaults.data?.locationId,
          salesOrderId: sourceDocumentId,
          shipmentId: undefined,
          userId: userId
        }
      });
      if (!salesOrderShipment.data || salesOrderShipment.error) {
        logger.error("Failed to create shipment", {
          error: salesOrderShipment.error
        });
        throw redirect(
          path.to.salesOrder(sourceDocumentId),
          await flash(
            request,
            error(salesOrderShipment.error, "Failed to create shipment")
          )
        );
      }

      throw redirect(path.to.shipmentDetails(salesOrderShipment.data.id));
    case "Purchase Order":
      const purchaseOrderShipment = await serviceRole.functions.invoke<{
        id: string;
      }>("create", {
        body: {
          type: "shipmentFromPurchaseOrder",
          companyId,
          locationId: defaults.data?.locationId,
          purchaseOrderId: sourceDocumentId,
          shipmentId: undefined,
          userId: userId
        }
      });
      if (!purchaseOrderShipment.data || purchaseOrderShipment.error) {
        logger.error("Failed to create shipment", {
          error: purchaseOrderShipment.error
        });
        throw redirect(
          path.to.purchaseOrder(sourceDocumentId),
          await flash(
            request,
            error(purchaseOrderShipment.error, "Failed to create shipment")
          )
        );
      }

      throw redirect(path.to.shipmentDetails(purchaseOrderShipment.data.id));
    case "Outbound Transfer":
      const warehouseTransferShipment = await serviceRole.functions.invoke<{
        id: string;
      }>("create", {
        body: {
          type: "shipmentFromWarehouseTransfer",
          companyId,
          warehouseTransferId: sourceDocumentId,
          shipmentId: undefined,
          userId: userId
        }
      });
      if (!warehouseTransferShipment.data || warehouseTransferShipment.error) {
        logger.error("Failed to create shipment", {
          error: warehouseTransferShipment.error
        });
        throw redirect(
          path.to.warehouseTransferDetails(sourceDocumentId),
          await flash(
            request,
            error(warehouseTransferShipment.error, "Failed to create shipment")
          )
        );
      }

      throw redirect(
        path.to.shipmentDetails(warehouseTransferShipment.data.id)
      );
    default:
      const defaultShipment = await serviceRole.functions.invoke<{
        id: string;
      }>("create", {
        body: {
          type: "shipmentDefault",
          companyId,
          locationId: defaults.data?.locationId,
          userId: userId
        }
      });

      if (!defaultShipment.data || defaultShipment.error) {
        logger.error("Failed to create shipment", {
          error: defaultShipment.error
        });
        throw redirect(
          path.to.shipments,
          await flash(request, error(error, "Failed to create shipment"))
        );
      }

      throw redirect(path.to.shipmentDetails(defaultShipment.data.id));
  }
}
