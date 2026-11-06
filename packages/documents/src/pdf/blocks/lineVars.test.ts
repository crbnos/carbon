// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { buildPurchaseOrderLineVars } from "./purchaseOrder/vars";
import { buildSalesOrderLineVars } from "./salesOrder/vars";
import { buildStockTransferLineVars } from "./stockTransfer/vars";
import { addressVars } from "./textVars";
import { buildSalesInvoiceLineVars } from "./vars";

const formatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2
});
const formats = {
  numberFormatter: formatter,
  rateFormatter: formatter,
  locale: "en-US"
};

describe("table row variables", () => {
  it("prints only the description on a comment line", () => {
    const row = buildPurchaseOrderLineVars(
      {
        purchaseOrderLineType: "Comment",
        description: "Handle with care",
        purchaseQuantity: 5,
        supplierUnitPrice: 2
      } as never,
      3,
      { ...formats, purchaseOrder: { purchaseOrderType: "Purchase" } as never }
    );
    expect(row["line.description"]).toBe("Handle with care");
    expect(row["line.number"]).toBe("");
    expect(row["line.quantity"]).toBe("");
    expect(row["line.total"]).toBe("");
  });

  it("prints a missing quantity or unit as nothing, not as a word", () => {
    const order = buildSalesOrderLineVars(
      { salesOrderLineType: "Part", saleQuantity: null } as never,
      1,
      formats
    );
    expect(order["line.quantity"]).toBe("");
    const transfer = buildStockTransferLineVars(
      { quantity: null, unitOfMeasure: null } as never,
      1,
      "Any"
    );
    expect(transfer["line.quantity"]).toBe("");
    expect(transfer["line.unit"]).toBe("");
  });
});

describe("a rental invoice line", () => {
  // A rental line has no item: its generated sentence is the line's description.
  const line = {
    id: "a",
    invoiceLineType: "Rental",
    itemReadableId: null,
    description: "2026-08-07 – 2026-09-03 · 28 days — Smallsat Bus",
    quantity: 1
  } as never;

  it("prints its sentence as one value", () => {
    const row = buildSalesInvoiceLineVars(line, 1, formats);
    expect(row["line.details"]).toBe(
      "2026-08-07 – 2026-09-03 · 28 days — Smallsat Bus"
    );
  });
});

describe("addressVars", () => {
  it("names each line after the party and joins state and postal code", () => {
    expect(
      addressVars("supplier", {
        name: "Steelworks Ltd",
        city: "Leeds",
        stateProvince: "WY",
        postalCode: null
      })
    ).toEqual({
      "supplier.name": "Steelworks Ltd",
      "supplier.addressLine1": "",
      "supplier.addressLine2": "",
      "supplier.city": "Leeds",
      "supplier.statePostal": "WY",
      "supplier.country": ""
    });
  });
});
