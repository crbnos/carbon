// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { distinctItemText, EPSILON } from "@carbon/utils";

export function getLineDescription(
  line: Database["public"]["Views"]["salesInvoiceLines"]["Row"]
) {
  switch (line?.invoiceLineType) {
    case "Fixed Asset":
      return (
        (line as any)?.assetReadableId ??
        (line as any)?.assetName ??
        "Fixed Asset"
      );
    case "Comment":
      return line?.description;
    default:
      return line?.itemReadableId;
  }
}

export function getLineDescriptionDetails(
  line: Database["public"]["Views"]["salesInvoiceLines"]["Row"]
) {
  switch (line?.invoiceLineType) {
    case "Fixed Asset":
      return line?.description;
    case "Comment":
    default:
      // A service's readable id is its name — don't print it twice.
      return distinctItemText(line?.itemReadableId, line?.description) ?? "";
  }
}

/**
 * The line's list merchandise amount, `quantity × convertedUnitPrice`, before
 * the line discount. Documents render in the invoice currency.
 */
export function getLineGrossMerchandise(
  line: Database["public"]["Views"]["salesInvoiceLines"]["Row"]
) {
  return (line?.quantity ?? 0) * (line?.convertedUnitPrice ?? 0);
}

/**
 * The line discount's amount. `discountPercent` is a fraction from 0 to 1 and
 * discounts merchandise only — add-ons and shipping are never discounted.
 */
export function getLineDiscount(
  line: Database["public"]["Views"]["salesInvoiceLines"]["Row"]
) {
  return getLineGrossMerchandise(line) * (line?.discountPercent ?? 0);
}

/** The line's merchandise amount after its discount. */
export function getLineMerchandise(
  line: Database["public"]["Views"]["salesInvoiceLines"]["Row"]
) {
  return getLineGrossMerchandise(line) - getLineDiscount(line);
}

export function getLineSubtotal(
  line: Database["public"]["Views"]["salesInvoiceLines"]["Row"]
) {
  return (
    getLineMerchandise(line) +
    (line?.convertedAddOnCost ?? 0) +
    (line?.convertedNonTaxableAddOnCost ?? 0) +
    (line?.convertedShippingCost ?? 0)
  );
}

/** Tax is charged on the discounted merchandise. */
export function getLineTaxableSubtotal(
  line: Database["public"]["Views"]["salesInvoiceLines"]["Row"]
) {
  return (
    getLineMerchandise(line) +
    (line?.convertedAddOnCost ?? 0) +
    (line?.convertedShippingCost ?? 0)
  );
}

export function getLineTaxesAndFees(
  line: Database["public"]["Views"]["salesInvoiceLines"]["Row"]
) {
  const taxPercent = line.taxPercent ?? 0;
  const tax = getLineTaxableSubtotal(line) * taxPercent;
  const fees =
    (line.convertedAddOnCost ?? 0) +
    (line.convertedNonTaxableAddOnCost ?? 0) +
    (line.convertedShippingCost ?? 0);
  return tax + fees;
}

export function getLineTotal(
  line: Database["public"]["Views"]["salesInvoiceLines"]["Row"]
) {
  const taxPercent = line.taxPercent ?? 0;
  const tax = getLineTaxableSubtotal(line) * taxPercent;
  return getLineSubtotal(line) + tax;
}

/**
 * The tax on the invoice's header shipping, in document currency. A line
 * whose code taxes shipping adds its share of header shipping to its tax
 * base; the `salesInvoices` view's `totalTax` includes that tax
 * (`20261017042424_sales-invoice-shipping-tax.sql`), so it is the view's tax
 * less the lines' own.
 */
export function getHeaderShippingTax(
  lines: Database["public"]["Views"]["salesInvoiceLines"]["Row"][],
  salesInvoice: Database["public"]["Views"]["salesInvoices"]["Row"]
) {
  if (salesInvoice.totalTax === null || salesInvoice.totalTax === undefined) {
    return 0;
  }
  const lineTax = lines.reduce(
    (sum, line) => sum + getLineTaxableSubtotal(line) * (line.taxPercent ?? 0),
    0
  );
  const headerTax =
    (salesInvoice.totalTax ?? 0) * (salesInvoice.exchangeRate ?? 1) - lineTax;
  return Math.abs(headerTax) < EPSILON ? 0 : headerTax;
}

/** Every tax on the invoice, in document currency. */
export function getTaxTotal(
  lines: Database["public"]["Views"]["salesInvoiceLines"]["Row"][],
  salesInvoice: Database["public"]["Views"]["salesInvoices"]["Row"]
) {
  return (
    lines.reduce(
      (sum, line) =>
        sum + getLineTaxableSubtotal(line) * (line.taxPercent ?? 0),
      0
    ) + getHeaderShippingTax(lines, salesInvoice)
  );
}

export function getTotal(
  lines: Database["public"]["Views"]["salesInvoiceLines"]["Row"][],
  salesInvoice: Database["public"]["Views"]["salesInvoices"]["Row"],
  salesInvoiceShipment: Database["public"]["Tables"]["salesInvoiceShipment"]["Row"]
) {
  let total = 0;

  lines.forEach((line) => {
    total += getLineTotal(line);
  });

  return (
    total +
    getHeaderShippingTax(lines, salesInvoice) +
    (salesInvoiceShipment.shippingCost ?? 0) * (salesInvoice.exchangeRate ?? 1)
  );
}
