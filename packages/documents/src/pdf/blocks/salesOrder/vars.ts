// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate, formatPercent } from "@carbon/utils";
import type { LineMergeToken, MergeToken } from "../../../template";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getLineTaxableSubtotal,
  getLineTotal,
  getTotal
} from "../../../utils/sales-order";
import { addressVars, companyVars, incotermText, str } from "../textVars";
import type { SalesOrderData } from "./types";

/**
 * Merge-field variable map for a Sales Order. Tokens mirror
 * `SALES_ORDER_MERGE_FIELDS` in template/mergeFields.ts.
 */
export function buildSalesOrderVars(
  data: Pick<
    SalesOrderData,
    | "salesOrder"
    | "salesOrderLines"
    | "salesOrderLocations"
    | "company"
    | "currencyCode"
    | "locale"
    | "paymentTerms"
    | "shippingMethods"
    | "numberFormatter"
  >
): Record<MergeToken<"salesOrder">, string> {
  const so = data.salesOrder;
  const lines = data.salesOrderLines;
  const loc = data.salesOrderLocations;
  const money = (v: number) => data.numberFormatter.format(v);
  const date = (v: string | null | undefined) =>
    formatDate(v, undefined, data.locale);

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
  const shipping =
    lines.reduce((sum, line) => sum + (line.convertedShippingCost ?? 0), 0) +
    (so?.shippingCost ?? 0) * (so?.exchangeRate ?? 1);
  const hasTax = lines.some((line) => (line.taxPercent ?? 0) > 0);
  const tax = lines.reduce(
    (sum, line) => sum + getLineTaxableSubtotal(line) * (line.taxPercent ?? 0),
    0
  );

  return {
    "order.number": str(so?.salesOrderId),
    "order.date": date(so?.orderDate),
    "order.customerReference": str(so?.customerReference),
    "order.requestedDate": date(so?.receiptRequestedDate),
    "order.promisedDate": date(so?.receiptPromisedDate),
    "order.paymentTerms": str(
      data.paymentTerms?.find((term) => term.id === so?.paymentTermId)?.name
    ),
    "order.shippingMethod": str(
      data.shippingMethods?.find((method) => method.id === so?.shippingMethodId)
        ?.name
    ),
    "order.shippingTerms": str(so?.shippingTermName),
    "order.incoterm": incotermText(so?.incoterm, so?.incotermLocation),
    "order.currency": str(data.currencyCode),
    "order.subtotal": money(
      lines.reduce(
        (sum, line) =>
          sum + (line.saleQuantity ?? 0) * (line.convertedUnitPrice ?? 0),
        0
      )
    ),
    "order.addOns": hasAddOns ? money(addOns) : "",
    "order.shipping": shipping > 0 ? money(shipping) : "",
    "order.tax": hasTax ? money(tax) : "",
    "order.total": money(getTotal(lines, so)),
    ...addressVars("customer", {
      name: loc?.customerName,
      addressLine1: loc?.customerAddressLine1,
      addressLine2: loc?.customerAddressLine2,
      city: loc?.customerCity,
      stateProvince: loc?.customerStateProvince,
      postalCode: loc?.customerPostalCode,
      country: loc?.customerCountryName
    }),

    "customer.taxId": str(loc?.customerTaxId),
    "customer.vatNumber": str(loc?.customerVatNumber),
    "customer.eori": str(loc?.customerEori),
    ...addressVars("billTo", {
      name: loc?.paymentCustomerName,
      addressLine1: loc?.paymentAddressLine1,
      addressLine2: loc?.paymentAddressLine2,
      city: loc?.paymentCity,
      stateProvince: loc?.paymentStateProvince,
      postalCode: loc?.paymentPostalCode,
      country: loc?.paymentCountryName
    }),

    ...companyVars(data.company)
  };
}

/** A comment line prints only its description. */
export function buildSalesOrderLineVars(
  line: SalesOrderData["salesOrderLines"][number],
  rowNumber: number,
  data: Pick<SalesOrderData, "numberFormatter" | "rateFormatter" | "locale">
): Record<LineMergeToken<"salesOrder">, string> {
  const money = (v: number) => data.numberFormatter.format(v);
  const positive = (v: number) => (v > 0 ? money(v) : "");
  const taxPercent = line.taxPercent ?? 0;
  const common = {
    "line.description": str(getLineDescription(line)),
    "line.details": str(getLineDescriptionDetails(line))
  };

  if (line.salesOrderLineType === "Comment") {
    return {
      ...common,
      "line.number": "",
      "line.quantity": "",
      "line.unit": "",
      "line.unitPrice": "",
      "line.total": "",
      "line.shipping": "",
      "line.addOn": "",
      "line.nonTaxableAddOn": "",
      "line.taxPercent": "",
      "line.taxAmount": ""
    };
  }

  return {
    ...common,
    "line.number": String(rowNumber),
    "line.quantity": str(line.saleQuantity),
    "line.unit": line.unitOfMeasureCode ?? "EA",
    "line.unitPrice": data.rateFormatter.format(line.convertedUnitPrice ?? 0),
    "line.total": money(getLineTotal(line)),
    "line.shipping": positive(line.convertedShippingCost ?? 0),
    "line.addOn": positive(line.convertedAddOnCost ?? 0),
    "line.nonTaxableAddOn": positive(line.convertedNonTaxableAddOnCost ?? 0),
    "line.taxPercent":
      taxPercent > 0 ? formatPercent(taxPercent, data.locale) : "",
    "line.taxAmount":
      taxPercent > 0 ? money(getLineTaxableSubtotal(line) * taxPercent) : ""
  };
}
