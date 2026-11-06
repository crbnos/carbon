// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate } from "@carbon/utils";
import type { MergeToken, RowVars } from "../../../template";
import { addressVars, companyVars, str } from "../textVars";
import type { PackingSlipData, PackingSlipRentalUnit } from "./types";

/** Merge-field variable map for a Packing Slip. */
export function buildPackingSlipVars(
  data: Pick<
    PackingSlipData,
    | "shipment"
    | "customer"
    | "customerReference"
    | "sourceDocument"
    | "sourceDocumentId"
    | "shippingAddress"
    | "shippingMethod"
    | "paymentTerm"
    | "company"
    | "locale"
  >
): Record<MergeToken<"packingSlip">, string> {
  const s = data.shipment;
  const a = data.shippingAddress;
  // The source prints as "Sales Order: SO-1", so one without the other prints nothing.
  const hasSource = Boolean(data.sourceDocument && data.sourceDocumentId);

  return {
    "shipment.number": str(s?.shipmentId),
    "shipment.trackingNumber": str(s?.trackingNumber),
    "shipment.date": formatDate(s?.postingDate, undefined, data.locale),
    "shipment.sourceDocument": hasSource ? str(data.sourceDocument) : "",
    "shipment.sourceDocumentId": hasSource ? str(data.sourceDocumentId) : "",
    "shipment.customerReference": str(data.customerReference),
    "shipment.method": str(data.shippingMethod?.name),
    "shipment.paymentTerm": str(data.paymentTerm?.name),
    ...addressVars("customer", {
      name: data.customer?.name,
      addressLine1: a?.addressLine1,
      addressLine2: a?.addressLine2,
      city: a?.city,
      stateProvince: a?.stateProvince,
      postalCode: a?.postalCode,
      country: a?.countryCode
    }),

    ...companyVars(data.company)
  };
}

/**
 * The serial cell prints once per tracked
 * entity, and the table passes each id as `line.serialBatch`; elsewhere in the
 * row `{line.serialBatch}` lists them all.
 */
export function buildPackingSlipLineVars(
  line: PackingSlipData["shipmentLines"][number],
  serialBatch: string[]
): RowVars<"packingSlip", "line"> {
  return {
    "line.item": str(line.itemReadableId),
    "line.description": str(line.description),
    "line.shippedQuantity": str(line.shippedQuantity),
    "line.orderQuantity": str(line.orderQuantity),
    "line.unit": str(line.unitOfMeasure),
    "line.serialBatch": serialBatch.join(", ")
  };
}

/** One unit per row. */
export function buildPackingSlipRentalUnitVars(
  unit: PackingSlipRentalUnit
): RowVars<"packingSlip", "unit"> {
  return {
    "unit.name": str(unit.name),
    "unit.assetId": str(unit.assetReadableId),
    "unit.quantity": unit.quantity ?? "1",
    "unit.serial": str(unit.serialNumber)
  };
}
