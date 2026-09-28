import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { Shipment, ShipmentLine } from "~/modules/inventory";
import { shipmentValidator } from "~/modules/inventory";
import { updateShipmentDetails } from "~/modules/inventory/inventory.server";
import {
  ShipmentForm,
  ShipmentLines,
  ShipmentNotes
} from "~/modules/inventory/ui/Shipments";
import type { Note } from "~/modules/shared";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

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

  // Shared with the inventory_upsertShipment tool: a changed source document or
  // location rebuilds the shipment from the new source.
  const result = await updateShipmentDetails(client, {
    companyId,
    userId,
    shipment: { id, ...d, customFields: setCustomFields(formData) }
  });

  if (result.error) {
    if (
      result.error.flash === "Failed to load shipment" ||
      result.error.flash === "Failed to update shipment"
    ) {
      return data(
        {},
        await flash(
          request,
          error(result.error.cause ?? null, result.error.flash)
        )
      );
    }
    throw redirect(
      path.to.shipment(id),
      await flash(
        request,
        error(result.error.cause ?? null, result.error.flash)
      )
    );
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
