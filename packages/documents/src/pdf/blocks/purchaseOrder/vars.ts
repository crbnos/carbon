// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate } from "@carbon/utils";
import type { LineMergeToken, MergeToken } from "../../../template";
import {
  getLineDescriptionDetails,
  getLineSupplierPartId,
  getLineTotal,
  getPurchaseOrderDisplayId,
  getTotal
} from "../../../utils/purchase-order";
import { formatTaxPercent } from "../../../utils/shared";
import { addressVars, companyVars, incotermText, str } from "../textVars";
import type { PurchaseOrderData } from "./types";

/** Merge-field variable map for a Purchase Order. */
export function buildPurchaseOrderVars(
  data: Pick<
    PurchaseOrderData,
    | "purchaseOrder"
    | "purchaseOrderLines"
    | "purchaseOrderLocations"
    | "company"
    | "currencyCode"
    | "approval"
    | "locale"
    | "paymentTerms"
    | "accountsPayableBillingAddress"
    | "numberFormatter"
  >
): Record<MergeToken<"purchaseOrder">, string> {
  const po = data.purchaseOrder;
  const lines = data.purchaseOrderLines;
  const loc = data.purchaseOrderLocations;
  const money = (v: number) => data.numberFormatter.format(v);
  const date = (v: string | null | undefined) =>
    formatDate(v, undefined, data.locale);

  const shippingCost = po?.supplierShippingCost ?? 0;
  const subtotal = lines.reduce(
    (acc, line) =>
      acc +
      (line.purchaseQuantity ?? 0) * (line.supplierUnitPrice ?? 0) +
      (line.supplierShippingCost ?? 0),
    0
  );
  const tax = lines.reduce(
    (acc, line) => acc + (line.supplierTaxAmount ?? 0),
    0
  );

  // A drop shipment goes to the customer, anything else to the delivery location.
  const deliverTo = loc?.dropShipment
    ? {
        name: loc.customerName,
        addressLine1: loc.customerAddressLine1,
        addressLine2: loc.customerAddressLine2,
        city: loc.customerCity,
        stateProvince: loc.customerStateProvince,
        postalCode: loc.customerPostalCode,
        country: loc.customerCountryName ?? loc.customerCountryCode
      }
    : {
        name: loc?.deliveryName,
        addressLine1: loc?.deliveryAddressLine1,
        addressLine2: loc?.deliveryAddressLine2,
        city: loc?.deliveryCity,
        stateProvince: loc?.deliveryStateProvince,
        postalCode: loc?.deliveryPostalCode,
        country: loc?.deliveryCountryName ?? loc?.deliveryCountryCode
      };

  return {
    "order.number": po ? getPurchaseOrderDisplayId(po) : "",
    "order.id": str(po?.purchaseOrderId),
    "order.revision": str(po?.revisionId ?? 0),
    "order.date": date(po?.orderDate),
    "order.requestedDate": date(po?.receiptRequestedDate),
    "order.promisedDate": date(po?.receiptPromisedDate),
    "order.paymentTerms": str(
      data.paymentTerms?.find((term) => term.id === po?.paymentTermId)?.name
    ),
    "order.incoterm": incotermText(po?.incoterm, po?.incotermLocation),
    "order.supplierReference": str(po?.supplierReference),
    "order.currency": str(data.currencyCode),
    "order.approvedBy": str(data.approval?.approvedBy),
    "order.approvedDate": date(data.approval?.approvedDate),
    "order.billingEmail": str(data.accountsPayableBillingAddress?.email),
    "order.subtotal": money(subtotal),
    "order.shipping": shippingCost > 0 ? money(shippingCost) : "",
    "order.tax": tax > 0 ? money(tax) : "",
    "order.total": money(getTotal(lines) + shippingCost),
    ...addressVars("supplier", {
      name: loc?.supplierName,
      addressLine1: loc?.supplierAddressLine1,
      addressLine2: loc?.supplierAddressLine2,
      city: loc?.supplierCity,
      stateProvince: loc?.supplierStateProvince,
      postalCode: loc?.supplierPostalCode,
      country: loc?.supplierCountryName ?? loc?.supplierCountryCode
    }),

    "supplier.taxId": str(loc?.supplierTaxId),
    "supplier.vatNumber": str(loc?.supplierVatNumber),
    "supplier.eori": str(loc?.supplierEori),
    "supplier.contactName": str(loc?.supplierContactName),
    "supplier.contactEmail": str(loc?.supplierContactEmail),
    "buyer.name": str(
      po?.assigneeFullName ??
        po?.accountManagerFullName ??
        po?.createdByFullName
    ),
    "buyer.email": str(
      po?.assigneeEmail ?? po?.accountManagerEmail ?? po?.createdByEmail
    ),
    "buyer.phone": str(
      po?.assigneePhone ?? po?.accountManagerPhone ?? po?.createdByPhone
    ),
    ...addressVars("deliverTo", {
      name: deliverTo.name,
      addressLine1: deliverTo.addressLine1,
      addressLine2: deliverTo.addressLine2,
      city: deliverTo.city,
      stateProvince: deliverTo.stateProvince,
      postalCode: deliverTo.postalCode,
      country: deliverTo.country
    }),

    ...companyVars(data.company)
  };
}

const INDIRECT_TYPES = new Set([
  "Service",
  "G/L Account",
  "Fixed Asset",
  "Comment"
]);

/** A comment line prints only its description. */
export function buildPurchaseOrderLineVars(
  line: PurchaseOrderData["purchaseOrderLines"][number],
  rowNumber: number,
  data: Pick<
    PurchaseOrderData,
    "purchaseOrder" | "numberFormatter" | "rateFormatter" | "locale"
  >
): Record<LineMergeToken<"purchaseOrder">, string> {
  const money = (v: number) => data.numberFormatter.format(v);
  const indirect = INDIRECT_TYPES.has(line.purchaseOrderLineType ?? "");
  const shipping = line.supplierShippingCost ?? 0;
  const common = {
    "line.description": str(indirect ? line.description : line.itemReadableId),
    "line.details": indirect ? "" : str(getLineDescriptionDetails(line)),
    // A Service line prints its description, so the number repeats only that.
    "line.supplierPartId":
      !indirect || line.purchaseOrderLineType === "Service"
        ? str(
            getLineSupplierPartId(
              line,
              indirect ? line.description : line.itemReadableId
            )
          )
        : "",
    "line.operation":
      data.purchaseOrder.purchaseOrderType === "Outside Processing"
        ? str(line.jobOperationDescription)
        : "",
    "line.shipping": shipping > 0 ? money(shipping) : ""
  };

  if (line.purchaseOrderLineType === "Comment") {
    return {
      ...common,
      "line.number": "",
      "line.quantity": "",
      "line.unit": "",
      "line.requiredDate": "",
      "line.unitPrice": "",
      "line.netValue": "",
      "line.taxAmount": "",
      "line.taxPercent": "",
      "line.total": ""
    };
  }

  return {
    ...common,
    "line.number": String(rowNumber),
    "line.quantity": str(line.purchaseQuantity),
    "line.unit": str(line.purchaseUnitOfMeasureCode),
    "line.requiredDate": formatDate(line.requiredDate, undefined, data.locale),
    "line.unitPrice": data.rateFormatter.format(line.supplierUnitPrice ?? 0),
    "line.netValue": money(
      (line.purchaseQuantity ?? 0) * (line.supplierUnitPrice ?? 0)
    ),
    "line.taxAmount": money(line.supplierTaxAmount ?? 0),
    "line.taxPercent": str(formatTaxPercent(line.taxPercent, data.locale)),
    "line.total": money(getLineTotal(line))
  };
}
