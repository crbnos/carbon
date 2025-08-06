import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { FunctionRegion } from "@supabase/supabase-js";
import { redirect, type LoaderFunctionArgs } from "@vercel/remix";
import type { ShipmentSourceDocument } from "~/modules/inventory";
import { getUserDefaults } from "~/modules/users/users.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Shipments",
  to: path.to.shipments,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory",
  });

  const url = new URL(request.url);
  const sourceDocument =
    (url.searchParams.get("sourceDocument") as ShipmentSourceDocument) ??
    undefined;
  const sourceDocumentId = url.searchParams.get("sourceDocumentId") ?? "";

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
          userId: userId,
        },
        region: FunctionRegion.UsEast1,
      });
      if (!salesOrderShipment.data || salesOrderShipment.error) {
        console.error(salesOrderShipment.error);
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
          userId: userId,
        },
        region: FunctionRegion.UsEast1,
      });
      if (!purchaseOrderShipment.data || purchaseOrderShipment.error) {
        console.error(purchaseOrderShipment.error);
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
          userId: userId,
        },
        region: FunctionRegion.UsEast1,
      });
      if (!warehouseTransferShipment.data || warehouseTransferShipment.error) {
        console.error(warehouseTransferShipment.error);
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
          userId: userId,
        },
        region: FunctionRegion.UsEast1,
      });

      if (!defaultShipment.data || defaultShipment.error) {
        console.error(defaultShipment.error);
        throw redirect(
          path.to.shipments,
          await flash(request, error(error, "Failed to create shipment"))
        );
      }

      throw redirect(path.to.shipmentDetails(defaultShipment.data.id));
  }
}
