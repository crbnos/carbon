// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate, formatPercent } from "@carbon/utils";
import type { LineMergeToken, MergeToken } from "../../template";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getLineDiscount,
  getLineGrossMerchandise,
  getLineTaxableSubtotal,
  getLineTotal,
  getTotal
} from "../../utils/sales-invoice";
import { addressVars, companyVars, incotermText, str } from "./textVars";
import type { SalesInvoiceData } from "./types";

/**
 * Build the merge-field variable map for a Sales Invoice. Tokens here must stay
 * in sync with `SALES_INVOICE_MERGE_FIELDS` in template/merge.ts (the catalog
 * the editor offers). Missing values resolve to "" so a token never prints raw.
 */
export function buildSalesInvoiceVars(
  data: Pick<
    SalesInvoiceData,
    | "salesInvoice"
    | "salesInvoiceLines"
    | "salesInvoiceLocations"
    | "salesInvoiceShipment"
    | "salesOrderIds"
    | "paymentTerms"
    | "shippingMethods"
    | "shippingTerms"
    | "company"
    | "currencyCode"
    | "locale"
    | "numberFormatter"
  >
): Record<MergeToken<"salesInvoice">, string> {
  const inv = data.salesInvoice;
  const lines = data.salesInvoiceLines;
  const loc = data.salesInvoiceLocations;
  const shipment = data.salesInvoiceShipment;
  const money = (v: number) => data.numberFormatter.format(v);
  const date = (v: string | null | undefined) =>
    formatDate(v, undefined, data.locale);

  const discount = lines.reduce((sum, line) => sum + getLineDiscount(line), 0);
  const hasAddOns = lines.some(
    (line) =>
      (line.convertedAddOnCost ?? 0) > 0 ||
      (line.convertedNonTaxableAddOnCost ?? 0) > 0
  );
  const addOns = lines.reduce(
    (sum, line) =>
      sum +
      (line.convertedAddOnCost ?? 0) +
      (line.convertedNonTaxableAddOnCost ?? 0),
    0
  );
  const lineShipping = lines.reduce(
    (sum, line) => sum + (line.convertedShippingCost ?? 0),
    0
  );
  const shipping =
    lineShipping + (shipment?.shippingCost ?? 0) * (inv?.exchangeRate ?? 1);
  const tax = lines.reduce(
    (sum, line) => sum + getLineTaxableSubtotal(line) * (line.taxPercent ?? 0),
    0
  );

  return {
    "invoice.number": str(inv?.invoiceId),
    "invoice.dateIssued": date(inv?.dateIssued),
    "invoice.dateDue": date(inv?.dateDue),
    "invoice.customerReference": str(inv?.customerReference),
    "invoice.currency": str(data.currencyCode),
    "invoice.salesOrders": (data.salesOrderIds ?? []).join(", "),
    "invoice.paymentTerms": str(
      data.paymentTerms?.find((term) => term.id === inv?.paymentTermId)?.name
    ),
    "invoice.shippingMethod": str(
      data.shippingMethods?.find(
        (method) => method.id === shipment?.shippingMethodId
      )?.name
    ),
    "invoice.shippingTerms": str(
      data.shippingTerms?.find((term) => term.id === shipment?.shippingTermId)
        ?.name
    ),
    "invoice.incoterm": incotermText(
      shipment?.incoterm,
      shipment?.incotermLocation
    ),
    "invoice.subtotal": money(
      lines.reduce((sum, line) => sum + getLineGrossMerchandise(line), 0)
    ),
    "invoice.discount": discount !== 0 ? money(-discount) : "",
    "invoice.addOns": hasAddOns ? money(addOns) : "",
    "invoice.shipping": shipping > 0 ? money(shipping) : "",
    "invoice.tax": lines.some((line) => (line.taxPercent ?? 0) > 0)
      ? money(tax)
      : "",
    "invoice.total":
      inv && shipment ? money(getTotal(lines, inv, shipment)) : "",
    ...addressVars("customer", {
      name: loc?.invoiceCustomerName ?? loc?.customerName,
      addressLine1: loc?.invoiceAddressLine1 ?? loc?.customerAddressLine1,
      addressLine2: loc?.invoiceAddressLine2 ?? loc?.customerAddressLine2,
      city: loc?.invoiceCity ?? loc?.customerCity,
      stateProvince: loc?.invoiceStateProvince ?? loc?.customerStateProvince,
      postalCode: loc?.invoicePostalCode ?? loc?.customerPostalCode,
      country: loc?.invoiceCountryName ?? loc?.customerCountryName
    }),

    "customer.taxId": str(loc?.customerTaxId),
    "customer.vatNumber": str(loc?.customerVatNumber),
    "customer.eori": str(loc?.customerEori),
    "customer.contactName": str(loc?.contactName),
    "customer.contactEmail": str(loc?.contactEmail),
    ...addressVars("shipTo", {
      name: loc?.shipmentCustomerName,
      addressLine1: loc?.shipmentAddressLine1,
      addressLine2: loc?.shipmentAddressLine2,
      city: loc?.shipmentCity,
      stateProvince: loc?.shipmentStateProvince,
      postalCode: loc?.shipmentPostalCode,
      country: loc?.shipmentCountryName
    }),

    ...companyVars(data.company)
  };
}

/** A comment line prints only its description. */
export function buildSalesInvoiceLineVars(
  line: SalesInvoiceData["salesInvoiceLines"][number],
  rowNumber: number,
  data: Pick<SalesInvoiceData, "numberFormatter" | "rateFormatter" | "locale">
): Record<LineMergeToken<"salesInvoice">, string> {
  const money = (v: number) => data.numberFormatter.format(v);
  const common = {
    "line.description": str(getLineDescription(line)),
    "line.details": str(getLineDescriptionDetails(line))
  };

  if (line.invoiceLineType === "Comment") {
    return {
      ...common,
      "line.number": "",
      "line.quantity": "",
      "line.unit": "",
      "line.unitPrice": "",
      "line.discountPercent": "",
      "line.total": "",
      "line.shipping": "",
      "line.addOn": "",
      "line.nonTaxableAddOn": "",
      "line.taxAmount": "",
      "line.taxPercent": ""
    };
  }

  const addOn = line.convertedAddOnCost ?? 0;
  const nonTaxableAddOn = line.convertedNonTaxableAddOnCost ?? 0;
  const shipping = line.convertedShippingCost ?? 0;
  const taxPercent = line.taxPercent ?? 0;
  const discountPercent = line.discountPercent ?? 0;

  return {
    ...common,
    "line.number": String(rowNumber),
    "line.quantity": str(line.quantity),
    "line.unit": line.unitOfMeasureCode ?? "EA",
    "line.unitPrice": data.rateFormatter.format(line.convertedUnitPrice ?? 0),
    "line.discountPercent":
      discountPercent > 0 ? formatPercent(-discountPercent, data.locale) : "",
    "line.total": money(getLineTotal(line)),
    "line.shipping": shipping > 0 ? money(shipping) : "",
    "line.addOn": addOn > 0 ? money(addOn) : "",
    "line.nonTaxableAddOn": nonTaxableAddOn > 0 ? money(nonTaxableAddOn) : "",
    "line.taxAmount":
      taxPercent > 0 ? money(getLineTaxableSubtotal(line) * taxPercent) : "",
    "line.taxPercent":
      taxPercent > 0 ? formatPercent(taxPercent, data.locale) : ""
  };
}
