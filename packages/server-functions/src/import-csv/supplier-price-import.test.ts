// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { buildItemIndex } from "./existing-item";
import {
  classifySupplierPriceRow,
  pairKey,
  planPriceLadders
} from "./supplier-price-import";

const index = buildItemIndex([
  { id: "item-bolt", readableId: "BOLT-M6", revision: "0", type: "Part" },
  { id: "item-nut", readableId: "NUT-M6", revision: "0", type: "Consumable" },
  { id: "item-coat", readableId: "COAT-1", revision: "0", type: "Service" },
  { id: "item-fix", readableId: "FIX-9", revision: "0", type: "Fixture" }
]);

const row = (overrides: Record<string, string> = {}) => ({
  readableId: "BOLT-M6",
  revision: "",
  supplierId: "sup-a",
  quantity: "100",
  unitPrice: "0.25",
  ...overrides
});

const classify = (overrides: Record<string, string> = {}) =>
  classifySupplierPriceRow(row(overrides), index);

describe("classifySupplierPriceRow", () => {
  it("reads a price break, with the lead time the app writes when none is given", () => {
    expect(classify()).toEqual({
      action: "price",
      pairKey: pairKey("item-bolt", "sup-a"),
      label: "BOLT-M6 rev 0",
      price: {
        itemId: "item-bolt",
        supplierId: "sup-a",
        quantity: 100,
        unitPrice: 0.25,
        leadTime: 0
      }
    });
    expect(classify({ leadTime: "14" })).toMatchObject({
      price: { leadTime: 14 }
    });
  });

  it("takes every item type with a Purchasing tab, and no other", () => {
    expect(classify({ readableId: "NUT-M6" })).toMatchObject({
      action: "price"
    });
    expect(classify({ readableId: "COAT-1" })).toMatchObject({
      action: "price"
    });
    expect(classify({ readableId: "FIX-9" })).toMatchObject({
      action: "error",
      reason:
        "Item FIX-9 rev 0 is a Fixture; this import takes Part, Material, Tool, Consumable, Service items"
    });
  });

  it("refuses what the price-break table refuses: a quantity or price of 0 or less", () => {
    for (const quantity of ["0", "-5", "", "ten"]) {
      expect(classify({ quantity })).toEqual({
        action: "error",
        reason: "Quantity must be a number greater than 0",
        pairKey: pairKey("item-bolt", "sup-a")
      });
    }
    for (const unitPrice of ["0", "-1", ""]) {
      expect(classify({ unitPrice })).toMatchObject({
        action: "error",
        reason: "Unit Price must be a number greater than 0"
      });
    }
    // Rounded to the stored scale first, as the drawer's input commits it.
    expect(classify({ unitPrice: "0.000001" })).toMatchObject({
      action: "error"
    });
    expect(classify({ unitPrice: "0.00123" })).toMatchObject({
      price: { unitPrice: 0.00123 }
    });
  });

  it("refuses a negative lead time and a missing supplier", () => {
    expect(classify({ leadTime: "-1" })).toMatchObject({
      action: "error",
      reason: "Lead Time must be a number of 0 or more"
    });
    expect(classify({ supplierId: "" })).toEqual({
      action: "error",
      reason: "Missing required Supplier"
    });
  });
});

describe("planPriceLadders", () => {
  const plan = (rows: Array<Record<string, string>>) =>
    planPriceLadders(rows.map((r, i) => ({ row: i, decision: classify(r) })));

  it("builds one ladder per item and supplier from the file's rows", () => {
    const { ladders, errors } = plan([
      { quantity: "1", unitPrice: "0.30" },
      { quantity: "100", unitPrice: "0.25" },
      { supplierId: "sup-b", quantity: "1", unitPrice: "0.28" },
      { readableId: "NUT-M6", quantity: "500", unitPrice: "0.02" }
    ]);
    expect(errors).toEqual([]);
    expect(
      ladders.map((l) => [
        l.itemId,
        l.supplierId,
        l.breaks.map((b) => [b.row, b.quantity])
      ])
    ).toEqual([
      [
        "item-bolt",
        "sup-a",
        [
          [0, 1],
          [1, 100]
        ]
      ],
      ["item-bolt", "sup-b", [[2, 1]]],
      ["item-nut", "sup-a", [[3, 500]]]
    ]);
  });

  it("refuses a repeated quantity on the later row and leaves that ladder alone", () => {
    const { ladders, errors } = plan([
      { quantity: "10", unitPrice: "0.30" },
      { quantity: "10.000001", unitPrice: "0.29" },
      { quantity: "50", unitPrice: "0.27" },
      { supplierId: "sup-b", quantity: "10", unitPrice: "0.31" }
    ]);
    expect(ladders.map((l) => l.supplierId)).toEqual(["sup-b"]);
    expect(errors.map((e) => e.row)).toEqual([0, 1, 2]);
    expect(errors[1]!.reason).toBe(
      "Duplicate quantity 10 for this item and supplier in file"
    );
    expect(errors[0]!.reason).toMatch(
      /^Not imported: another row for BOLT-M6 rev 0 from this supplier has an error/
    );
  });

  it("drops a ladder with any bad row, but a row naming no item taints nothing", () => {
    const { ladders, errors } = plan([
      { quantity: "1", unitPrice: "0.30" },
      { quantity: "100", unitPrice: "0" },
      { readableId: "NOPE", supplierId: "sup-b" },
      { supplierId: "sup-b", quantity: "1", unitPrice: "0.28" }
    ]);
    expect(ladders.map((l) => l.supplierId)).toEqual(["sup-b"]);
    expect(errors).toEqual([
      {
        row: 0,
        reason:
          "Not imported: another row for BOLT-M6 rev 0 from this supplier has an error, so its price breaks were left as they were"
      },
      { row: 1, reason: "Unit Price must be a number greater than 0" },
      { row: 2, reason: "Item NOPE rev 0 not found" }
    ]);
  });

  it("accounts for every row exactly once", () => {
    const rows: Array<Record<string, string>> = [
      { quantity: "1" },
      { quantity: "1" },
      { quantity: "5", unitPrice: "x" },
      { supplierId: "sup-b", quantity: "1" },
      { supplierId: "sup-b", quantity: "2" },
      { readableId: "" }
    ];
    const { ladders, errors } = plan(rows);
    const written = ladders.flatMap((l) => l.breaks.map((b) => b.row));
    expect([...written, ...errors.map((e) => e.row)].sort()).toEqual([
      0, 1, 2, 3, 4, 5
    ]);
  });
});
