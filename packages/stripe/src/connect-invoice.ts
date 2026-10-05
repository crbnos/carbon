// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The pure half of the Carbon sales invoice → Stripe invoice mapping. No Stripe
// client, env or database access lives here, so it can be imported (and
// tested) without configuring any of them. `connect.server` and
// `send-sales-invoice.server` re-export the pieces they used to define.

import type { Database } from "@carbon/database";
import { formatPercent } from "@carbon/utils";

/**
 * One Carbon `salesInvoiceLine`, as the Stripe mapping needs to see it.
 *
 * Every amount is in the INVOICE currency — the currency the Stripe invoice is
 * created in — never the company's base currency. The cost components are NOT
 * interchangeable and — apart from `unitPrice` — are NOT per-unit. This mirrors
 * the `salesInvoices` view, which is the single definition of what a Carbon
 * sales invoice is worth (migration `20261004014728_sales-invoice-discount-and-ship-to.sql`),
 * applied to the `converted*` columns:
 *
 *   net      = unitPrice·(1 − discountPercent)
 *   subtotal = Σ (quantity·net + addOnCost + nonTaxableAddOnCost + shippingCost)
 *   totalTax = Σ taxPercent·(quantity·net + addOnCost + shippingCost)
 *   total    = subtotal + totalTax + salesInvoiceShipment.shippingCost
 *
 * The line discount is already applied by the caller: `unitPrice` here IS the
 * net price (`toStripeInvoiceLines`), so the Stripe items and
 * `expectedConnectInvoiceTotal` read one number and cannot disagree.
 *
 * Three consequences worth stating out loud, because each one is a way to bill
 * the customer an amount Carbon's ledger disagrees with:
 *  - `nonTaxableAddOnCost` counts toward the subtotal but NOT the tax base.
 *  - the header-level shipping cost is added AFTER tax and is never taxed.
 *  - `setupPrice` appears in neither sum, so it is deliberately absent from
 *    this type. Billing it would collect more cash than the invoice is owed,
 *    and `recordStripeConnectPayment` settles whatever Stripe collected.
 */
export type ConnectInvoiceLineInput = {
  description: string;
  /** `salesInvoiceLine.quantity` — NUMERIC, so genuinely fractional. */
  quantity: number;
  /**
   * Per-unit price NET of the line discount, in the invoice currency —
   * `salesInvoiceLine.convertedNetUnitPrice`, unrounded. The discount covers
   * merchandise only; the flat components below are never discounted.
   */
  unitPrice: number;
  /** Flat per-line surcharge, taxable. Not multiplied by quantity. */
  addOnCost?: number;
  /** Flat per-line freight, taxable. Not multiplied by quantity. */
  shippingCost?: number;
  /** Flat per-line surcharge, NOT taxed. */
  nonTaxableAddOnCost?: number;
  /**
   * A FRACTION in [0, 1] — that is the column's CHECK constraint, not a
   * percent. 0.0825 means 8.25%. Passing 8.25 here would bill 825% tax.
   */
  taxPercent?: number;
  unitOfMeasureCode?: string | null;
  /** Carbon ids for traceability; merged into every item this line emits. */
  metadata?: Record<string, string>;
};

/**
 * What Carbon says this invoice is worth, by the `salesInvoices` view's own
 * arithmetic, in the invoice currency. Exported so callers gate on the same
 * number Stripe will be reconciled against instead of an independent (and
 * quietly different) sum.
 *
 * `line.unitPrice` is the NET unit price (see `ConnectInvoiceLineInput`), the
 * same value each Stripe unit item is created with, so the drift check against
 * Stripe's draft total holds for discounted lines too. `shippingCost` is the
 * invoice-level freight, already converted to the invoice currency.
 */
export function expectedConnectInvoiceTotal(params: {
  lines: ConnectInvoiceLineInput[];
  shippingCost?: number;
}): { subtotal: number; tax: number; shipping: number; total: number } {
  let subtotal = 0;
  let tax = 0;

  for (const line of params.lines) {
    const taxable =
      line.unitPrice * line.quantity +
      (line.addOnCost ?? 0) +
      (line.shippingCost ?? 0);
    subtotal += taxable + (line.nonTaxableAddOnCost ?? 0);
    tax += (line.taxPercent ?? 0) * taxable;
  }

  const shipping = params.shippingCost ?? 0;
  return { subtotal, tax, shipping, total: subtotal + tax + shipping };
}

export type SalesInvoiceLineRow =
  Database["public"]["Views"]["salesInvoiceLines"]["Row"];

/**
 * Carbon invoice lines → the Stripe mapping's line input.
 *
 * Comment lines carry no money and exist only to annotate the printed invoice,
 * so they are dropped rather than sent as zero-amount items.
 *
 * Every amount is the line's `converted*` column: Stripe bills in the invoice's
 * own currency, and the unprefixed `unitPrice` / `addOnCost` / `shippingCost` /
 * `nonTaxableAddOnCost` are the company's BASE currency. Sending those under
 * the invoice's `currencyCode` billed a EUR invoice its USD amounts.
 * `taxPercent` stays the fraction the column stores.
 *
 * The line discount (`discountPercent`, a fraction) is applied through the
 * unit price: the price sent is `convertedNetUnitPrice`, the generated
 * `unitPrice × exchangeRate × (1 − discountPercent)`, unrounded — Stripe takes
 * a decimal unit amount and rounds once per item, after the quantity — and the
 * description says "(20% off)". It discounts the merchandise only, as the
 * `salesInvoices` view does — add-ons and shipping pass through at full price.
 * Stripe coupons are not used: a coupon discounts the whole invoice, and
 * per-line discounts would not round-trip.
 */
export function toStripeInvoiceLines(
  lines: SalesInvoiceLineRow[]
): ConnectInvoiceLineInput[] {
  return lines
    .filter((line) => line.invoiceLineType !== "Comment")
    .map((line) => {
      const description = line.description ?? line.itemReadableId ?? "Item";
      const discountPercent = line.discountPercent ?? 0;
      return {
        description: discountPercent
          ? `${description} (${formatPercent(discountPercent, "en-US")} off)`
          : description,
        quantity: line.quantity ?? 0,
        unitPrice: line.convertedNetUnitPrice ?? 0,
        addOnCost: line.convertedAddOnCost ?? 0,
        shippingCost: line.convertedShippingCost ?? 0,
        nonTaxableAddOnCost: line.convertedNonTaxableAddOnCost ?? 0,
        taxPercent: line.taxPercent ?? 0,
        unitOfMeasureCode: line.unitOfMeasureCode,
        metadata: {
          carbonLineId: line.id ?? "",
          carbonItemId: line.itemId ?? "",
          carbonLineType: line.invoiceLineType ?? "",
          carbonSalesOrderId: line.salesOrderId ?? "",
          carbonSalesOrderLineId: line.salesOrderLineId ?? ""
        }
      };
    });
}
