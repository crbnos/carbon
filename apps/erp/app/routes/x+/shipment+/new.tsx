// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import type { ServerFnResult } from "@carbon/server-functions";
import { ServerFnContext } from "@carbon/server-functions";
import { create } from "@carbon/server-functions/create";
import { getErrorMessage } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import type { ShipmentSourceDocument } from "~/modules/inventory";
import { getUserDefaults } from "~/modules/users/users.server";
import { getDatabaseClient } from "~/services/database.server";
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
      const salesOrderShipment = await (create(
        ServerFnContext.system({ db: getDatabaseClient(), companyId, userId }),
        {
          type: "shipmentFromSalesOrder",
          locationId: defaults.data?.locationId,
          salesOrderId: sourceDocumentId,
          shipmentId: undefined
        }
      ) as Promise<
        ServerFnResult<{
          id: string;
        }>
      >);
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
              getErrorMessage(
                salesOrderShipment.error,
                "Failed to create shipment"
              )
            )
          )
        );
      }

      throw redirect(path.to.shipmentDetails(salesOrderShipment.data.id));
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

      const salesReturnShipment = await (create(
        ServerFnContext.system({ db: getDatabaseClient(), companyId, userId }),
        {
          type: "shipmentFromSalesReturnOrder",
          locationId: defaults.data?.locationId as string | undefined,
          salesReturnOrderId: sourceDocumentId,
          shipmentId: undefined
        }
      ) as Promise<
        ServerFnResult<{
          id: string;
        }>
      >);
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
              getErrorMessage(
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

      const purchaseReturnShipment = await (create(
        ServerFnContext.system({ db: getDatabaseClient(), companyId, userId }),
        {
          type: "shipmentFromPurchaseReturnOrder",
          locationId: defaults.data?.locationId as string | undefined,
          purchaseReturnOrderId: sourceDocumentId,
          shipmentId: undefined
        }
      ) as Promise<
        ServerFnResult<{
          id: string;
        }>
      >);
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
              getErrorMessage(
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
      const purchaseOrderShipment = await (create(
        ServerFnContext.system({ db: getDatabaseClient(), companyId, userId }),
        {
          type: "shipmentFromPurchaseOrder",
          locationId: defaults.data?.locationId,
          purchaseOrderId: sourceDocumentId,
          shipmentId: undefined
        }
      ) as Promise<
        ServerFnResult<{
          id: string;
        }>
      >);
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
              getErrorMessage(
                purchaseOrderShipment.error,
                "Failed to create shipment"
              )
            )
          )
        );
      }

      throw redirect(path.to.shipmentDetails(purchaseOrderShipment.data.id));
    case "Outbound Transfer":
      const warehouseTransferShipment = await (create(
        ServerFnContext.system({ db: getDatabaseClient(), companyId, userId }),
        {
          type: "shipmentFromWarehouseTransfer",
          warehouseTransferId: sourceDocumentId,
          shipmentId: undefined
        }
      ) as Promise<
        ServerFnResult<{
          id: string;
        }>
      >);
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
              getErrorMessage(
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
      const defaultShipment = await (create(
        ServerFnContext.system({ db: getDatabaseClient(), companyId, userId }),
        {
          type: "shipmentDefault",
          locationId: defaults.data?.locationId as string | undefined
        }
      ) as Promise<
        ServerFnResult<{
          id: string;
        }>
      >);

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
              getErrorMessage(
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
