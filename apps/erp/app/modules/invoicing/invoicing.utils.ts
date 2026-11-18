// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { EPSILON } from "@carbon/utils";
import { flatChargeShare } from "../shared/shared.utils";

/** The fields of a sales invoice line its amounts are built from. */
export type SalesInvoiceLineMoney = {
  quantity: number | null;
  netUnitPrice: number | null;
  convertedNetUnitPrice: number | null;
  addOnCost: number | null;
  convertedAddOnCost: number | null;
  nonTaxableAddOnCost: number | null;
  convertedNonTaxableAddOnCost: number | null;
  shippingCost: number | null;
  convertedShippingCost: number | null;
  taxPercent: number | null;
};

/**
 * A sales invoice line's amounts, in base currency and in the invoice's own
 * currency. Merchandise is NET of the line discount, as in the
 * `salesInvoices` view; add-ons and line shipping are not discounted. Tax is
 * on merchandise, add-ons and line shipping, not on the non-taxable add-on.
 */
export function salesInvoiceLineAmounts(line: SalesInvoiceLineMoney) {
  const quantity = line.quantity ?? 0;
  const taxPercent = line.taxPercent ?? 0;

  const merchandise = (line.netUnitPrice ?? 0) * quantity;
  const taxable =
    merchandise + (line.addOnCost ?? 0) + (line.shippingCost ?? 0);
  const subtotal = taxable + (line.nonTaxableAddOnCost ?? 0);
  const tax = taxPercent * taxable;

  const customerMerchandise = (line.convertedNetUnitPrice ?? 0) * quantity;
  const customerTaxable =
    customerMerchandise +
    (line.convertedAddOnCost ?? 0) +
    (line.convertedShippingCost ?? 0);
  const customerSubtotal =
    customerTaxable + (line.convertedNonTaxableAddOnCost ?? 0);
  const customerTax = taxPercent * customerTaxable;

  return {
    merchandise,
    subtotal,
    tax,
    total: subtotal + tax,
    customerMerchandise,
    customerSubtotal,
    customerTax,
    customerTotal: customerSubtotal + customerTax
  };
}

/** The flat charges of an order line, billed once across its invoices. */
export const ORDER_LINE_CHARGE_FIELDS = [
  "addOnCost",
  "nonTaxableAddOnCost",
  "shippingCost"
] as const;
type OrderLineChargeField = (typeof ORDER_LINE_CHARGE_FIELDS)[number];

/**
 * What the invoice's sales orders still hold that this invoice could bill,
 * read by `getSalesInvoicePostFacts`. "Billed" counts every other non-voided
 * invoice of the order, drafts included, as the order conversion counts it
 * (`billedSalesOrderCharges`).
 */
export type SalesInvoicePostFacts = {
  orderLines: {
    salesOrderLineId: string;
    /**
     * The order line's unit price: a stored 0 was agreed on the order; null
     * means it was never priced.
     */
    unitPrice: number | null;
    orderedQuantity: number;
    /** `quantityToInvoice`: ordered less what posted invoices billed. */
    remainingQuantity: number;
    /**
     * What other invoices not yet posted (Draft, or Pending while a post runs)
     * already bill of it: it is not in `remainingQuantity` yet.
     */
    unpostedQuantity: number;
    /** How many other non-voided invoices bill this order line. */
    otherInvoices: number;
    charges: Record<OrderLineChargeField, { charge: number; billed: number }>;
  }[];
  orders: {
    salesOrderId: string;
    readableId: string;
    /** The order's shipping no other invoice bills. */
    unbilledShipping: number;
  }[];
  /**
   * Today's rate for the invoice's currency (`get_exchange_rate`), or null
   * when it could not be read.
   */
  currentExchangeRate: number | null;
};

export type SalesInvoicePostCheckLine = {
  id: string | null;
  invoiceLineType: string | null;
  quantity: number | null;
  unitPrice: number | null;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  addOnCost: number | null;
  nonTaxableAddOnCost: number | null;
  shippingCost: number | null;
};

/**
 * Something on a draft invoice that is almost always a mistake, shown before
 * posting because a posted invoice cannot be edited. Each one is a fact, not
 * a guess: a missing price, a line that bills nothing, more than the order
 * has left to invoice, a charge on the order this invoice leaves off, or a
 * foreign currency at 1 when today's rate is not. A $0 shipping total on its
 * own is NOT a check — free and buyer-paid freight are normal — so the
 * summary shows it without flagging it.
 */
export type SalesInvoicePostCheck =
  | { type: "noQuantity"; lineId: string }
  | { type: "noPrice"; lineId: string }
  | { type: "overInvoiced"; lineId: string; remainingQuantity: number }
  | { type: "orderChargesLeftOff"; lineId: string; amount: number }
  | {
      type: "orderShippingLeftOff";
      salesOrderReadableId: string;
      amount: number;
    }
  | { type: "exchangeRateNotSet"; currencyCode: string; currentRate: number };

export function salesInvoicePostChecks({
  lines,
  shippingCost,
  currencyCode,
  exchangeRate,
  baseCurrencyCode,
  decimals,
  facts
}: {
  lines: SalesInvoicePostCheckLine[];
  /** The invoice's own shipping (its Shipping section), base currency. */
  shippingCost: number;
  currencyCode: string | null;
  exchangeRate: number | null;
  baseCurrencyCode: string | null;
  /** The base currency's settlement decimals, as the order conversion uses. */
  decimals: number;
  facts: SalesInvoicePostFacts | null;
}): SalesInvoicePostCheck[] {
  const checks: SalesInvoicePostCheck[] = [];
  // A quantity share rounds to the minor unit, so N shares of one charge can
  // leave up to half a minor unit each unbilled.
  const halfMinorUnit = 10 ** -decimals / 2;
  const orderLines = new Map(
    (facts?.orderLines ?? []).map((line) => [line.salesOrderLineId, line])
  );
  // Lines that bill one order line are judged together: a line split in two
  // shares the order line's quantity and charges.
  const byOrderLine = new Map<string, SalesInvoicePostCheckLine[]>();
  // Shipping billed on a line beyond its order line's own share can be the
  // order's freight put on the line instead of the Shipping section.
  let lineShippingSurplus = 0;
  // The orders this invoice bills goods from: a credit or return invoice is
  // not where an order's freight is billed.
  const billingOrders = new Set<string>();

  for (const line of lines) {
    // A Comment line carries no charge.
    if (!line.id || line.invoiceLineType === "Comment") continue;
    const quantity = line.quantity ?? 0;

    const orderLine = line.salesOrderLineId
      ? orderLines.get(line.salesOrderLineId)
      : undefined;

    if (quantity > 0 && line.salesOrderId) billingOrders.add(line.salesOrderId);

    if (quantity === 0) {
      checks.push({ type: "noQuantity", lineId: line.id });
    } else if (
      (line.unitPrice ?? 0) === 0 &&
      orderLine?.unitPrice !== 0 &&
      // Without the order's facts a line from an order cannot be told apart
      // from an agreed $0, so it is not guessed at.
      !(line.salesOrderLineId && !facts)
    ) {
      // The unit price, not the line amount: an add-on or line shipping can
      // hide a missing price. A 100% discount keeps its list price. A $0 its
      // order line also has is what the order agreed, not a price forgotten
      // on the invoice.
      checks.push({ type: "noPrice", lineId: line.id });
    }

    if (line.salesOrderLineId && orderLine) {
      byOrderLine.set(line.salesOrderLineId, [
        ...(byOrderLine.get(line.salesOrderLineId) ?? []),
        line
      ]);
    } else {
      lineShippingSurplus += Math.max(0, line.shippingCost ?? 0);
    }
  }

  for (const [salesOrderLineId, group] of byOrderLine) {
    const orderLine = orderLines.get(salesOrderLineId)!;
    const lineId = group[0]!.id!;
    const quantity = group.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
    // A credit (negative quantity) takes back what was billed: neither a
    // double charge nor a charge left off.
    if (quantity <= 0) continue;

    const available = orderLine.remainingQuantity - orderLine.unpostedQuantity;
    if (quantity > available + EPSILON) {
      checks.push({
        type: "overInvoiced",
        lineId,
        remainingQuantity: Math.max(0, available)
      });
    }

    // Each flat charge is billed by quantity share, the rest on the invoice
    // that bills the last of the quantity: `flatChargeShare` with the posted
    // remaining quantity, exactly as the order and shipment conversions call
    // it, so an untouched converted invoice is never flagged.
    let leftOff = 0;
    const rounding = halfMinorUnit * (orderLine.otherInvoices + 1);
    for (const field of ORDER_LINE_CHARGE_FIELDS) {
      const { charge, billed } = orderLine.charges[field];
      const expected = flatChargeShare({
        charge,
        billed,
        quantity,
        remainingQuantity: orderLine.remainingQuantity,
        orderedQuantity: orderLine.orderedQuantity,
        decimals
      });
      const actual = group.reduce((sum, line) => sum + (line[field] ?? 0), 0);
      if (expected - actual > rounding + EPSILON) leftOff += expected - actual;
      if (field === "shippingCost") {
        lineShippingSurplus += Math.max(0, actual - expected);
      }
    }
    if (leftOff > EPSILON) {
      checks.push({ type: "orderChargesLeftOff", lineId, amount: leftOff });
    }
  }

  // The invoice's shipping counts against every order it bills, as another
  // invoice's does in `billedSalesOrderCharges`, so the check and the order
  // conversion agree on what is billed.
  const covered = shippingCost + lineShippingSurplus;
  for (const order of facts?.orders ?? []) {
    if (!billingOrders.has(order.salesOrderId)) continue;
    const leftOff = order.unbilledShipping - covered;
    if (leftOff > EPSILON) {
      checks.push({
        type: "orderShippingLeftOff",
        salesOrderReadableId: order.readableId,
        amount: leftOff
      });
    }
  }

  // Document `exchangeRate` is foreign units per base unit. A foreign currency
  // at exactly 1 is a rate never set, unless today's rate is 1 too (a
  // currency pegged to the base); an unread rate decides nothing.
  const currentRate = facts?.currentExchangeRate ?? null;
  if (
    currencyCode &&
    baseCurrencyCode &&
    currencyCode !== baseCurrencyCode &&
    Math.abs((exchangeRate ?? 1) - 1) < EPSILON &&
    currentRate !== null &&
    Math.abs(currentRate - 1) >= EPSILON
  ) {
    checks.push({ type: "exchangeRateNotSet", currencyCode, currentRate });
  }

  return checks;
}
