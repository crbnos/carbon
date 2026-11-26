// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";

type Tables = Database["public"]["Tables"];

export type SharedSupplierQuote = Pick<
  Tables["supplierQuote"]["Row"],
  "supplierQuoteId" | "status" | "expirationDate" | "currencyCode"
>;

export type SharedSupplierQuoteLine = Pick<
  Database["public"]["Views"]["supplierQuoteLines"]["Row"],
  | "id"
  | "itemReadableId"
  | "description"
  | "supplierQuoteLineType"
  | "quantity"
  | "purchaseUnitOfMeasureCode"
  | "inventoryUnitOfMeasureCode"
  | "externalNotes"
>;

export type SharedSupplierQuoteLinePrice = Pick<
  Tables["supplierQuoteLinePrice"]["Row"],
  | "supplierQuoteLineId"
  | "quantity"
  | "supplierUnitPrice"
  | "leadTime"
  | "supplierShippingCost"
  | "supplierTaxAmount"
>;

export type SharedQuoteCompany = Pick<
  Tables["company"]["Row"],
  "name" | "logoLight" | "logoDark"
>;

/**
 * What a supplier quote's share link sends the logged-out supplier: only the
 * fields the page shows or posts back. Internal notes, item costs, accounts,
 * base-currency prices and the company's registration details stay on the server.
 */
export function supplierQuoteForSupplier({
  quote,
  company,
  lines,
  prices
}: {
  quote: SharedSupplierQuote;
  company: SharedQuoteCompany | null;
  lines: SharedSupplierQuoteLine[];
  prices: SharedSupplierQuoteLinePrice[];
}): {
  quote: SharedSupplierQuote;
  company: SharedQuoteCompany | null;
  quoteLines: SharedSupplierQuoteLine[];
  quoteLinePrices: SharedSupplierQuoteLinePrice[];
} {
  return {
    quote: {
      supplierQuoteId: quote.supplierQuoteId,
      status: quote.status,
      expirationDate: quote.expirationDate,
      currencyCode: quote.currencyCode
    },
    company: company
      ? {
          name: company.name,
          logoLight: company.logoLight,
          logoDark: company.logoDark
        }
      : null,
    quoteLines: lines.map((line) => ({
      id: line.id,
      itemReadableId: line.itemReadableId,
      description: line.description,
      supplierQuoteLineType: line.supplierQuoteLineType,
      quantity: line.quantity,
      purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
      inventoryUnitOfMeasureCode: line.inventoryUnitOfMeasureCode,
      externalNotes: line.externalNotes
    })),
    quoteLinePrices: prices.map((price) => ({
      supplierQuoteLineId: price.supplierQuoteLineId,
      quantity: price.quantity,
      supplierUnitPrice: price.supplierUnitPrice,
      leadTime: price.leadTime,
      supplierShippingCost: price.supplierShippingCost,
      supplierTaxAmount: price.supplierTaxAmount
    }))
  };
}
