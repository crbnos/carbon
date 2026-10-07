// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  QuotationLine,
  QuotationPrice,
  SalesOrderLine
} from "../../types";

export type SelectedLine = {
  quantity: number;
  netUnitPrice: number;
  convertedNetUnitPrice: number;
  addOn: number;
  convertedAddOn: number;
  taxableAddOn: number;
  convertedTaxableAddOn: number;
  leadTime: number;
  shippingCost: number;
  convertedShippingCost: number;
  taxPercent: number;
  discountPercent: number;
  unitPrice: number;
  convertedUnitPrice: number;
};

export const deselectedLine: SelectedLine = {
  addOn: 0,
  convertedAddOn: 0,
  taxableAddOn: 0,
  convertedTaxableAddOn: 0,
  netUnitPrice: 0,
  convertedNetUnitPrice: 0,
  quantity: 0,
  leadTime: 0,
  shippingCost: 0,
  convertedShippingCost: 0,
  taxPercent: 0,
  discountPercent: 0,
  unitPrice: 0,
  convertedUnitPrice: 0
};

type Line = Pick<
  QuotationLine,
  "id" | "quantity" | "additionalCharges" | "taxPercent"
>;
type Price = Pick<
  QuotationPrice,
  | "quoteLineId"
  | "quantity"
  | "netUnitPrice"
  | "convertedNetUnitPrice"
  | "leadTime"
  | "shippingCost"
  | "convertedShippingCost"
  | "discountPercent"
  | "unitPrice"
  | "convertedUnitPrice"
>;

function charges(line: Line, quantity: number, taxableOnly: boolean) {
  return Object.values(line.additionalCharges ?? {}).reduce(
    (total, charge) =>
      taxableOnly && charge.taxable === false
        ? total
        : total + charge.amounts?.[quantity],
    0
  );
}

function priced(line: Line, price: Price, exchangeRate: number): SelectedLine {
  const addOn = charges(line, price.quantity, false) || 0;
  const taxableAddOn = charges(line, price.quantity, true) || 0;
  return {
    quantity: price.quantity ?? 0,
    netUnitPrice: price.netUnitPrice ?? 0,
    convertedNetUnitPrice: price.convertedNetUnitPrice ?? 0,
    addOn,
    convertedAddOn: addOn * exchangeRate || 0,
    taxableAddOn,
    convertedTaxableAddOn: taxableAddOn * exchangeRate || 0,
    leadTime: price.leadTime,
    shippingCost: price.shippingCost ?? 0,
    convertedShippingCost: price.convertedShippingCost ?? 0,
    taxPercent: line.taxPercent ?? 0,
    discountPercent: price.discountPercent ?? 0,
    unitPrice: price.unitPrice ?? 0,
    convertedUnitPrice: price.convertedUnitPrice ?? 0
  };
}

/**
 * The quantity break each quote line is totalled at, from the quote's CURRENT
 * lines and prices. `picks` holds only what the user chose (line id → quantity,
 * 0 for none); every other line takes its default: the ordered quantity when
 * the quote became an order, else the first break that has a price.
 *
 * Derived on every render, never copied into state: a copy kept a deleted
 * line in the totals until the page was reloaded.
 */
export function selectQuoteLines({
  lines,
  prices,
  salesOrderLines,
  exchangeRate,
  picks
}: {
  lines: Line[] | undefined;
  prices: Price[] | undefined;
  salesOrderLines: Pick<SalesOrderLine, "id" | "saleQuantity">[] | undefined;
  exchangeRate: number;
  picks: Record<string, number>;
}): Record<string, SelectedLine> {
  const selected: Record<string, SelectedLine> = {};
  const ordered = Array.isArray(salesOrderLines) && salesOrderLines.length > 0;

  for (const line of lines ?? []) {
    if (!line.id) continue;
    const linePrices = (prices ?? []).filter((p) => p.quoteLineId === line.id);
    const pick = picks[line.id];
    const salesOrderLine = salesOrderLines?.find((s) => s.id === line.id);

    let price: Price | undefined;
    if (pick !== undefined) {
      price =
        pick === 0 ? undefined : linePrices.find((p) => p.quantity === pick);
    } else if (salesOrderLine) {
      price = linePrices.find(
        (p) => p.quantity === salesOrderLine.saleQuantity
      );
    } else if (!ordered) {
      price = linePrices.find((p) => line.quantity?.includes(p.quantity));
    }

    selected[line.id] = price
      ? priced(line, price, exchangeRate)
      : deselectedLine;
  }
  return selected;
}
