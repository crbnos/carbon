// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { supplierQuoteForSupplier } from "./purchasing.utils";

// Rows as the share page's loader reads them: whole rows, internal columns included.
const internal = { type: "doc", content: [{ type: "text", text: "margin" }] };
const quote = {
  id: "sq_1",
  supplierQuoteId: "SQ000001",
  status: "Draft" as const,
  expirationDate: "2027-04-07",
  currencyCode: "EUR",
  exchangeRate: 1.08,
  internalNotes: internal,
  externalNotes: null,
  createdBy: "user_1",
  companyId: "co_1"
};
const company = {
  name: "Acme Fabrication",
  logoLight: "https://cdn/light.png",
  logoDark: null,
  taxId: "TAX-1",
  addressLine1: "1 Main St",
  ownerId: "user_1"
};
const line = {
  id: "line_1",
  itemId: "item_1",
  itemReadableId: "BRKT-100",
  description: "Bracket",
  supplierQuoteLineType: "Part",
  quantity: [10, 50],
  purchaseUnitOfMeasureCode: "BOX",
  inventoryUnitOfMeasureCode: "EA",
  externalNotes: { type: "doc" },
  internalNotes: internal,
  unitCost: 4.2,
  accountName: "Cost of Goods Sold",
  thumbnailPath: "co_1/thumbnails/item_1.png"
};
const price = {
  supplierQuoteLineId: "line_1",
  quantity: 10,
  supplierUnitPrice: 5,
  leadTime: 7,
  supplierShippingCost: 2,
  supplierTaxAmount: 1,
  unitPrice: 4.63,
  shippingCost: 1.85,
  exchangeRate: 1.08,
  createdBy: "user_1"
};

describe("supplierQuoteForSupplier", () => {
  it("sends only what the supplier sees, never internal notes, costs or rates", () => {
    expect(
      supplierQuoteForSupplier({
        quote,
        company,
        lines: [line],
        prices: [price]
      })
    ).toEqual({
      quote: {
        supplierQuoteId: "SQ000001",
        status: "Draft",
        expirationDate: "2027-04-07",
        currencyCode: "EUR"
      },
      company: {
        name: "Acme Fabrication",
        logoLight: "https://cdn/light.png",
        logoDark: null
      },
      quoteLines: [
        {
          id: "line_1",
          itemReadableId: "BRKT-100",
          description: "Bracket",
          supplierQuoteLineType: "Part",
          quantity: [10, 50],
          purchaseUnitOfMeasureCode: "BOX",
          inventoryUnitOfMeasureCode: "EA",
          externalNotes: { type: "doc" }
        }
      ],
      quoteLinePrices: [
        {
          supplierQuoteLineId: "line_1",
          quantity: 10,
          supplierUnitPrice: 5,
          leadTime: 7,
          supplierShippingCost: 2,
          supplierTaxAmount: 1
        }
      ]
    });
  });

  it("sends no company when the company could not be read", () => {
    expect(
      supplierQuoteForSupplier({ quote, company: null, lines: [], prices: [] })
        .company
    ).toBeNull();
  });
});
