import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { Shipment, ShipmentLine } from "~/modules/inventory";
import {
  getShipment,
  shipmentValidator,
  upsertShipment
} from "~/modules/inventory";
import {
  ShipmentForm,
  ShipmentLines,
  ShipmentNotes
} from "~/modules/inventory/ui/Shipments";
import type { Note } from "~/modules/shared";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

const logger = getLogger("erp", "shipment", "details");

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(shipmentValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const currentShipment = await getShipment(client, id);
  if (currentShipment.error) {
    return data(
      {},
      await flash(
        request,
        error(currentShipment.error, "Failed to load shipment")
      )
    );
  }

  const shipmentDataHasChanged =
    currentShipment.data.sourceDocument !== d.sourceDocument ||
    currentShipment.data.sourceDocumentId !== d.sourceDocumentId ||
    currentShipment.data.locationId !== d.locationId;

  if (shipmentDataHasChanged) {
    const serviceRole = getCarbonServiceRole();
    switch (d.sourceDocument) {
      case "Sales Order":
        const salesOrderShipment = await serviceRole.functions.invoke<{
          id: string;
        }>("create", {
          body: {
            type: "shipmentFromSalesOrder",
            companyId,
            locationId: d.locationId,
            salesOrderId: d.sourceDocumentId,
            shipmentId: id,
            userId: userId
          }
        });
        if (!salesOrderShipment.data || salesOrderShipment.error) {
          logger.error("Failed to create shipment from source document", {
            error: salesOrderShipment.error
          });
          throw redirect(
            path.to.shipment(id),
            await flash(
              request,
              error(salesOrderShipment.error, "Failed to create shipment")
            )
          );
        }
        break;
      case "Purchase Order":
        const purchaseOrderShipment = await serviceRole.functions.invoke<{
          id: string;
        }>("create", {
          body: {
            type: "shipmentFromPurchaseOrder",
            companyId,
            locationId: d.locationId,
            purchaseOrderId: d.sourceDocumentId,
            shipmentId: id,
            userId: userId
          }
        });
        if (!purchaseOrderShipment.data || purchaseOrderShipment.error) {
          logger.error("Failed to create shipment from source document", {
            error: purchaseOrderShipment.error
          });
          throw redirect(
            path.to.shipment(id),
            await flash(
              request,
              error(purchaseOrderShipment.error, "Failed to create shipment")
            )
          );
        }
        break;
      case "Outbound Transfer":
        const warehouseTransferShipment = await serviceRole.functions.invoke<{
          id: string;
        }>("create", {
          body: {
            type: "shipmentFromWarehouseTransfer",
            companyId,
            warehouseTransferId: d.sourceDocumentId,
            shipmentId: id,
            userId: userId
          }
        });
        if (
          !warehouseTransferShipment.data ||
          warehouseTransferShipment.error
        ) {
          logger.error("Failed to create shipment from source document", {
            error: warehouseTransferShipment.error
          });
          throw redirect(
            path.to.shipment(id),
            await flash(
              request,
              error(
                warehouseTransferShipment.error,
                "Failed to create shipment"
              )
            )
          );
        }
        break;
      default:
        throw new Error(`Unsupported source document: ${d.sourceDocument}`);
    }
  } else {
    const updateShipment = await upsertShipment(client, {
      id,
      ...d,
      updatedBy: userId,
      customFields: setCustomFields(formData)
    });

    if (updateShipment.error) {
      return data(
        {},
        await flash(
          request,
          error(updateShipment.error, "Failed to update shipment")
        )
      );
    }
  }

  throw redirect(
    path.to.shipment(id),
    await flash(request, success("Updated shipment"))
  );
}

export default function ShipmentDetailsRoute() {
  const { shipmentId } = useParams();
  if (!shipmentId) throw new Error("Could not find shipmentId");

  const routeData = useRouteData<{
    shipment: Shipment;
    shipmentLines: ShipmentLine[];
    notes: Note[];
  }>(path.to.shipment(shipmentId));

  if (!routeData?.shipment)
    throw new Error("Could not find shipment in routeData");

  const initialValues = {
    ...routeData.shipment,
    shipmentId: routeData.shipment.shipmentId ?? undefined,
    trackingNumber: routeData.shipment.trackingNumber ?? undefined,
    shippingMethodId: routeData.shipment.shippingMethodId ?? undefined,
    sourceDocument: (routeData.shipment.sourceDocument ?? "Sales Order") as
      | "Sales Order"
      | "Purchase Order"
      | "Outbound Transfer",
    sourceDocumentId: routeData.shipment.sourceDocumentId ?? undefined,
    sourceDocumentReadableId:
      routeData.shipment.sourceDocumentReadableId ?? undefined,
    locationId: routeData.shipment.locationId ?? undefined,
    ...getCustomFields(routeData.shipment.customFields)
  };

  return (
    <>
      <ShipmentForm
        key={initialValues.sourceDocumentId}
        // @ts-ignore
        initialValues={initialValues}
        status={routeData.shipment.status}
        shipmentLines={routeData.shipmentLines}
      />

      <ShipmentLines />

      <ShipmentNotes
        key={`notes-${initialValues.id}`}
        id={shipmentId}
        internalNotes={routeData.shipment.internalNotes as JSONContent}
        externalNotes={routeData.shipment.externalNotes as JSONContent}
      />
    </>
  );
}
