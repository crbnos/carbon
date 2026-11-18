// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import type {
  SalesInvoice,
  SalesInvoiceLine,
  SalesInvoiceShipment
} from "../../types";

/**
 * The invoice totals the summary card and the post modal both show, in base
 * currency and in the invoice's own currency. Merchandise is NET of the line
 * discount, as in the `salesInvoices` view.
 */
export function useSalesInvoiceTotals(invoiceId: string) {
  const routeData = useRouteData<{
    salesInvoice: SalesInvoice;
    salesInvoiceLines: SalesInvoiceLine[];
    salesInvoiceShipment: SalesInvoiceShipment;
  }>(path.to.salesInvoice(invoiceId));
  const { company } = useUser();

  const lines = routeData?.salesInvoiceLines ?? [];

  const subtotal = lines.reduce(
    (acc, line) =>
      acc +
      (line.netUnitPrice ?? 0) * (line.quantity ?? 0) +
      (line.shippingCost ?? 0) +
      (line.addOnCost ?? 0) +
      (line.nonTaxableAddOnCost ?? 0),
    0
  );

  const customerSubtotal = lines.reduce(
    (acc, line) =>
      acc +
      (line.convertedNetUnitPrice ?? 0) * (line.quantity ?? 0) +
      (line.convertedShippingCost ?? 0) +
      (line.convertedAddOnCost ?? 0) +
      (line.convertedNonTaxableAddOnCost ?? 0),
    0
  );

  const tax = lines.reduce(
    (acc, line) =>
      acc +
      (line.taxPercent ?? 0) *
        ((line.netUnitPrice ?? 0) * (line.quantity ?? 0) +
          (line.shippingCost ?? 0) +
          (line.addOnCost ?? 0)),
    0
  );

  const customerTax = lines.reduce(
    (acc, line) =>
      acc +
      (line.taxPercent ?? 0) *
        ((line.convertedNetUnitPrice ?? 0) * (line.quantity ?? 0) +
          (line.convertedShippingCost ?? 0) +
          (line.convertedAddOnCost ?? 0)),
    0
  );

  // `salesInvoiceShipment.shippingCost` is stored in BASE currency, like every
  // other raw column on this side -- the `salesInvoices` view adds it straight
  // onto a base subtotal built from `unitPrice`. So the base figure is the
  // stored value and only the customer-facing one converts.
  const shippingCost = routeData?.salesInvoiceShipment?.shippingCost ?? 0;
  const customerShippingCost =
    shippingCost * (routeData?.salesInvoice?.exchangeRate ?? 1);

  return {
    subtotal,
    customerSubtotal,
    tax,
    customerTax,
    shippingCost,
    customerShippingCost,
    total: subtotal + tax + shippingCost,
    customerTotal: customerSubtotal + customerTax + customerShippingCost,
    shouldConvertCurrency:
      routeData?.salesInvoice?.currencyCode !== company?.baseCurrencyCode
  };
}
