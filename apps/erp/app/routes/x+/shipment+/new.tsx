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
import { getEdgeFunctionErrorMessage } from "~/utils/error";
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
      if (!defaults.data?.locationId) {
        throw redirect(
          path.to.salesOrder(sourceDocumentId),
          await flash(
            request,
            error(
              null,
              "Set a default location in your settings before creating a shipment"
            )
          )
        );
      }
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
            error(
              salesOrderShipment.error,
              await getEdgeFunctionErrorMessage(
                salesOrderShipment.error,
                "Failed to create shipment"
              )
            )
          )
        );
      }

      throw redirect(path.to.shipmentDetails(salesOrderShipment.data.id));
    case "Repair Order": {
      // The leg says which way the unit is going: to the OEM, or home to the
      // customer. One open draft per leg, so clicking twice reuses the draft
      // instead of stacking duplicates.
      const leg =
        (formData.get("leg") as string) === "supplier"
          ? "supplier"
          : "customer";

      // The create function stamps supplierId on the supplier leg and
      // customerId on the customer leg, so the party column IS the leg
      // discriminator — filter on it rather than handing one leg the other's
      // draft.
      let existingRepairShipmentQuery = client
        .from("shipment")
        .select("id")
        .eq("sourceDocument", "Repair Order")
        .eq("sourceDocumentId", sourceDocumentId)
        .eq("status", "Draft")
        .eq("companyId", companyId);

      existingRepairShipmentQuery =
        leg === "supplier"
          ? existingRepairShipmentQuery.not("supplierId", "is", null)
          : existingRepairShipmentQuery.not("customerId", "is", null);

      const existingRepairShipment = await existingRepairShipmentQuery
        .order("createdAt", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingRepairShipment.error) {
        throw redirect(
          path.to.repairOrderDetails(sourceDocumentId),
          await flash(
            request,
            error(
              existingRepairShipment.error,
              "Failed to check for an existing shipment"
            )
          )
        );
      }
      if (existingRepairShipment.data) {
        throw redirect(path.to.shipmentDetails(existingRepairShipment.data.id));
      }

      const repairShipment = await serviceRole.functions.invoke<{
        id: string;
      }>("create", {
        body: {
          type: "shipmentFromRepairOrder",
          companyId,
          locationId: defaults.data?.locationId,
          repairOrderId: sourceDocumentId,
          leg,
          shipmentId: undefined,
          userId: userId
        }
      });
      if (!repairShipment.data || repairShipment.error) {
        logger.error("Failed to create repair shipment", {
          error: repairShipment.error
        });
        throw redirect(
          path.to.repairOrderDetails(sourceDocumentId),
          await flash(
            request,
            error(
              repairShipment.error,
              await getEdgeFunctionErrorMessage(
                repairShipment.error,
                "Failed to create shipment"
              )
            )
          )
        );
      }

      throw redirect(path.to.shipmentDetails(repairShipment.data.id));
    }
    case "Sales Return Order": {
      // One open draft per return order: clicking Ship again goes to the
      // existing draft instead of stacking up duplicates.
      const existingDraftsalesReturnShipment = await client
        .from("shipment")
        .select("id")
        .eq("sourceDocument", "Sales Return Order")
        .eq("sourceDocumentId", sourceDocumentId)
        .eq("status", "Draft")
        .eq("companyId", companyId)
        .order("createdAt", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingDraftsalesReturnShipment.error) {
        throw redirect(
          path.to.salesReturnOrderDetails(sourceDocumentId),
          await flash(
            request,
            error(
              existingDraftsalesReturnShipment.error,
              "Failed to check for an existing shipment"
            )
          )
        );
      }
      if (existingDraftsalesReturnShipment.data) {
        throw redirect(
          path.to.shipmentDetails(existingDraftsalesReturnShipment.data.id)
        );
      }

      const salesReturnShipment = await serviceRole.functions.invoke<{
        id: string;
      }>("create", {
        body: {
          type: "shipmentFromSalesReturnOrder",
          companyId,
          locationId: defaults.data?.locationId,
          salesReturnOrderId: sourceDocumentId,
          shipmentId: undefined,
          userId: userId
        }
      });
      if (!salesReturnShipment.data || salesReturnShipment.error) {
        logger.error("Failed to create shipment", {
          error: salesReturnShipment.error
        });
        throw redirect(
          path.to.salesReturnOrderDetails(sourceDocumentId),
          await flash(
            request,
            error(
              salesReturnShipment.error,
              await getEdgeFunctionErrorMessage(
                salesReturnShipment.error,
                "Failed to create shipment"
              )
            )
          )
        );
      }

      throw redirect(path.to.shipmentDetails(salesReturnShipment.data.id));
    }
    case "Purchase Return Order": {
      // One open draft per return order: clicking Ship again goes to the
      // existing draft instead of stacking up duplicates.
      const existingDraftpurchaseReturnShipment = await client
        .from("shipment")
        .select("id")
        .eq("sourceDocument", "Purchase Return Order")
        .eq("sourceDocumentId", sourceDocumentId)
        .eq("status", "Draft")
        .eq("companyId", companyId)
        .order("createdAt", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingDraftpurchaseReturnShipment.error) {
        throw redirect(
          path.to.purchaseReturnOrderDetails(sourceDocumentId),
          await flash(
            request,
            error(
              existingDraftpurchaseReturnShipment.error,
              "Failed to check for an existing shipment"
            )
          )
        );
      }
      if (existingDraftpurchaseReturnShipment.data) {
        throw redirect(
          path.to.shipmentDetails(existingDraftpurchaseReturnShipment.data.id)
        );
      }

      const purchaseReturnShipment = await serviceRole.functions.invoke<{
        id: string;
      }>("create", {
        body: {
          type: "shipmentFromPurchaseReturnOrder",
          companyId,
          locationId: defaults.data?.locationId,
          purchaseReturnOrderId: sourceDocumentId,
          shipmentId: undefined,
          userId: userId
        }
      });
      if (!purchaseReturnShipment.data || purchaseReturnShipment.error) {
        logger.error("Failed to create shipment", {
          error: purchaseReturnShipment.error
        });
        throw redirect(
          path.to.purchaseReturnOrderDetails(sourceDocumentId),
          await flash(
            request,
            error(
              purchaseReturnShipment.error,
              await getEdgeFunctionErrorMessage(
                purchaseReturnShipment.error,
                "Failed to create shipment"
              )
            )
          )
        );
      }

      throw redirect(path.to.shipmentDetails(purchaseReturnShipment.data.id));
    }
    case "Purchase Order":
      if (!defaults.data?.locationId) {
        throw redirect(
          path.to.purchaseOrder(sourceDocumentId),
          await flash(
            request,
            error(
              null,
              "Set a default location in your settings before creating a shipment"
            )
          )
        );
      }
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
            error(
              purchaseOrderShipment.error,
              await getEdgeFunctionErrorMessage(
                purchaseOrderShipment.error,
                "Failed to create shipment"
              )
            )
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
            error(
              warehouseTransferShipment.error,
              await getEdgeFunctionErrorMessage(
                warehouseTransferShipment.error,
                "Failed to create shipment"
              )
            )
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
          await flash(
            request,
            error(
              defaultShipment.error,
              await getEdgeFunctionErrorMessage(
                defaultShipment.error,
                "Failed to create shipment"
              )
            )
          )
        );
      }

      throw redirect(path.to.shipmentDetails(defaultShipment.data.id));
  }
}
