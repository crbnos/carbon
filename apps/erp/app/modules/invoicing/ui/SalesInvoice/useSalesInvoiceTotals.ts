// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { salesInvoiceLineAmounts } from "../../invoicing.utils";
import type {
  SalesInvoice,
  SalesInvoiceLine,
  SalesInvoiceShipment
} from "../../types";

/**
 * The invoice totals the summary card and the post modal both show, in base
 * currency and in the invoice's own currency, summed from
 * `salesInvoiceLineAmounts` so a line and the totals can never disagree.
 */
export function useSalesInvoiceTotals(invoiceId: string) {
  const routeData = useRouteData<{
    salesInvoice: SalesInvoice;
    salesInvoiceLines: SalesInvoiceLine[];
    salesInvoiceShipment: SalesInvoiceShipment;
  }>(path.to.salesInvoice(invoiceId));
  const { company } = useUser();

  let subtotal = 0;
  let customerSubtotal = 0;
  let tax = 0;
  let customerTax = 0;
  for (const line of routeData?.salesInvoiceLines ?? []) {
    const amounts = salesInvoiceLineAmounts(line);
    subtotal += amounts.subtotal;
    customerSubtotal += amounts.customerSubtotal;
    tax += amounts.tax;
    customerTax += amounts.customerTax;
  }

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
