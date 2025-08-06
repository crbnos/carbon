import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { useParams } from "@remix-run/react";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type { Shipment, ShipmentLine } from "~/modules/inventory";
import {
  getShipment,
  shipmentValidator,
  upsertShipment,
} from "~/modules/inventory";
import {
  ShipmentForm,
  ShipmentLines,
  ShipmentNotes,
} from "~/modules/inventory/ui/Shipments";
import type { Note } from "~/modules/shared";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const formData = await request.formData();
  const validation = await validator(shipmentValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("id not found");

  const currentShipment = await getShipment(client, id);
  if (currentShipment.error) {
    return json(
      {},
      await flash(
        request,
        error(currentShipment.error, "Failed to load shipment")
      )
    );
  }

  const shipmentDataHasChanged =
    currentShipment.data.sourceDocument !== data.sourceDocument ||
    currentShipment.data.sourceDocumentId !== data.sourceDocumentId ||
    currentShipment.data.locationId !== data.locationId;

  if (shipmentDataHasChanged) {
    const serviceRole = getCarbonServiceRole();
    switch (data.sourceDocument) {
      case "Sales Order":
        const salesOrderShipment = await serviceRole.functions.invoke<{
          id: string;
        }>("create", {
          body: {
            type: "shipmentFromSalesOrder",
            companyId,
            locationId: data.locationId,
            salesOrderId: data.sourceDocumentId,
            shipmentId: id,
            userId: userId,
          },
          region: FunctionRegion.UsEast1,
        });
        if (!salesOrderShipment.data || salesOrderShipment.error) {
          console.error(salesOrderShipment.error);
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
            locationId: data.locationId,
            purchaseOrderId: data.sourceDocumentId,
            shipmentId: id,
            userId: userId,
          },
          region: FunctionRegion.UsEast1,
        });
        if (!purchaseOrderShipment.data || purchaseOrderShipment.error) {
          console.error(purchaseOrderShipment.error);
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
            warehouseTransferId: data.sourceDocumentId,
            shipmentId: id,
            userId: userId,
          },
          region: FunctionRegion.UsEast1,
        });
        if (
          !warehouseTransferShipment.data ||
          warehouseTransferShipment.error
        ) {
          console.error(warehouseTransferShipment.error);
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
        throw new Error(`Unsupported source document: ${data.sourceDocument}`);
    }
  } else {
    const updateShipment = await upsertShipment(client, {
      id,
      ...data,
      updatedBy: userId,
      customFields: setCustomFields(formData),
    });

    if (updateShipment.error) {
      return json(
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
    ...getCustomFields(routeData.shipment.customFields),
  };

  return (
    <div className="flex flex-col gap-2 pb-16 w-full">
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
    </div>
  );
}
