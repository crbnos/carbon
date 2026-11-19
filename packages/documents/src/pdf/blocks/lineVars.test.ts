// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { buildPackingSlipLineVars } from "./packingSlip/vars";
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

  const poLine = (overrides: Record<string, unknown>) =>
    buildPurchaseOrderLineVars(
      {
        purchaseOrderLineType: "Part",
        itemReadableId: "P000123.B",
        supplierPartId: "SW-1045-50R",
        purchaseQuantity: 5,
        supplierUnitPrice: 2,
        ...overrides
      } as never,
      1,
      {
        ...formats,
        purchaseOrder: { purchaseOrderType: "Purchase" } as never,
        partNumberDisplayDraft: overrides.draft as never
      }
    );

  it("titles a PO line per its display choice, and keeps both numbers", () => {
    const row = poLine({ partNumberDisplay: "Theirs First" });
    expect(row["line.description"]).toBe("SW-1045-50R (P000123.B)");
    // The title shows it, so the default template's row stays empty.
    expect(row["line.supplierPartId"]).toBe("");
    expect(row["line.itemId"]).toBe("P000123.B");
    expect(row["line.supplierPartNumber"]).toBe("SW-1045-50R");
  });

  it("keeps the numbers whatever the choice", () => {
    const row = poLine({ partNumberDisplay: "Ours Only" });
    expect(row["line.description"]).toBe("P000123.B");
    expect(row["line.supplierPartId"]).toBe("");
    expect(row["line.supplierPartNumber"]).toBe("SW-1045-50R");
  });

  it("prints a legacy PO line as before: our number, the supplier's beneath", () => {
    const row = poLine({ partNumberDisplay: null });
    expect(row["line.description"]).toBe("P000123.B");
    expect(row["line.supplierPartId"]).toBe("SW-1045-50R");
  });

  it("prints the modal's draft over the line's choice", () => {
    const row = poLine({
      partNumberDisplay: "Theirs Only",
      draft: "Ours First"
    });
    expect(row["line.description"]).toBe("P000123.B (SW-1045-50R)");
  });

  it("prints a Service line's supplier number beneath its description", () => {
    const service = {
      purchaseOrderLineType: "Service",
      description: "Anodize, Type II",
      supplierPartId: "SVC-ANO-2"
    };
    expect(
      poLine({ ...service, partNumberDisplay: "Theirs First" })[
        "line.supplierPartId"
      ]
    ).toBe("SVC-ANO-2");
    expect(
      poLine({ ...service, partNumberDisplay: "Ours Only" })[
        "line.supplierPartId"
      ]
    ).toBe("");
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

describe("sales line part numbers", () => {
  const customerPart = {
    itemId: "item_1",
    itemReadableId: "P000123.B",
    customerPartId: "C-100",
    customerPartRevision: "3"
  };

  it("keeps the customer part number when the line prints ours only", () => {
    const row = buildSalesOrderLineVars(
      {
        salesOrderLineType: "Part",
        ...customerPart,
        partNumberDisplay: "Ours Only"
      } as never,
      1,
      formats
    );
    expect(row["line.description"]).toBe("P000123.B");
    expect(row["line.customerPartId"]).toBe("C-100");
    expect(row["line.customerPartRevision"]).toBe("3");
  });

  it("keeps our part number when the line prints theirs only", () => {
    const row = buildSalesInvoiceLineVars(
      {
        invoiceLineType: "Part",
        ...customerPart,
        partNumberDisplay: "Theirs Only"
      } as never,
      1,
      formats
    );
    expect(row["line.description"]).toBe("C-100 Rev 3");
    expect(row["line.itemId"]).toBe("P000123.B");
  });

  it("prints the modal's draft over a packing slip line's choice", () => {
    const row = buildPackingSlipLineVars(
      { ...customerPart, partNumberDisplay: "Theirs Only" } as never,
      [],
      "Ours Only"
    );
    expect(row["line.item"]).toBe("P000123.B");
    expect(row["line.customerPartId"]).toBe("C-100");
  });

  it("prints a legacy packing slip line's item ID only", () => {
    const row = buildPackingSlipLineVars(
      { ...customerPart, partNumberDisplay: null } as never,
      []
    );
    expect(row["line.item"]).toBe("P000123.B");
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
