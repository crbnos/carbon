// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { shipmentValidator } from "~/modules/inventory/inventory.models";
import type { Shipment, ShipmentLine } from "~/modules/inventory/types";
import {
  ShipmentForm,
  ShipmentLines,
  ShipmentNotes
} from "~/modules/inventory/ui/Shipments";
import type { Note } from "~/modules/shared/types";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(shipmentValidator).request(args, {
    params: ["shipmentId"]
  });
  if ("invalid" in input) return input.invalid;
  const { shipmentId } = input.params;
  const api = await carbon(args.request);
  const result = await api.inventory.updateShipment({
    ...input.data,
    // The document in the URL is the one updated, whatever the form's id says.
    id: shipmentId,
    customFields: input.formData && setCustomFields(input.formData)
  });
  return respond(args.request, result).redirect(path.to.shipment(shipmentId), {
    message: "Updated shipment"
  });
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
      | "Outbound Transfer"
      | "Rental Agreement",
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
        // @ts-expect-error
        initialValues={initialValues}
        status={routeData.shipment.status}
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
