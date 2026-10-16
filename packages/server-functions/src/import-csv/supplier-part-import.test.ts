// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { buildItemIndex } from "./existing-item";
import {
  classifySupplierPartRow,
  supplierPartKey
} from "./supplier-part-import";

const itemIndex = buildItemIndex([
  { id: "part-1", readableId: "BRK-10", revision: "0", type: "Part" },
  { id: "mat-1", readableId: "BAR-6061", revision: "A", type: "Material" },
  { id: "fix-1", readableId: "FX-1", revision: "0", type: "Fixture" }
]);

const classify = (
  record: Record<string, string>,
  seenKeys = new Set<string>()
) =>
  classifySupplierPartRow({
    record,
    itemIndex,
    seenKeys,
    currencyCodes: new Set(["EUR", "USD"])
  });

it("takes the drawer's defaults for blank cells", () => {
  expect(classify({ readableId: "BRK-10", supplierId: "sup-a" })).toEqual({
    action: "write",
    itemId: "part-1",
    supplierId: "sup-a",
    values: {
      supplierPartId: null,
      supplierUnitOfMeasureCode: null,
      minimumOrderQuantity: 1,
      orderMultiple: 1,
      conversionFactor: 1,
      supplierUnitPrice: null,
      currencyCode: null
    }
  });
});

it("reads every column, rounding to the stored scale", () => {
  expect(
    classify({
      readableId: "BAR-6061",
      revision: "A",
      supplierId: "sup-b",
      supplierPartId: " NW-6061 ",
      supplierUnitOfMeasureCode: "BOX",
      minimumOrderQuantity: "0",
      orderMultiple: "25",
      conversionFactor: "0.333333",
      unitPrice: "0.001234",
      currencyCode: "eur"
    })
  ).toMatchObject({
    action: "write",
    itemId: "mat-1",
    values: {
      supplierPartId: "NW-6061",
      supplierUnitOfMeasureCode: "BOX",
      minimumOrderQuantity: 0,
      orderMultiple: 25,
      conversionFactor: 0.33333,
      supplierUnitPrice: 0.00123,
      currencyCode: "EUR"
    }
  });
});

it("refuses numbers the drawer would refuse", () => {
  const row = { readableId: "BRK-10", supplierId: "sup-a" };
  expect(classify({ ...row, minimumOrderQuantity: "2.5" })).toEqual({
    action: "error",
    reason: "Minimum Order Quantity must be a whole number"
  });
  expect(classify({ ...row, orderMultiple: "0" })).toEqual({
    action: "error",
    reason: "Order Multiple must be 1 or more"
  });
  expect(classify({ ...row, unitPrice: "4.25 EUR" })).toEqual({
    action: "error",
    reason: "Unit Price must be a number"
  });
});

it("refuses an unknown currency", () => {
  expect(
    classify({ readableId: "BRK-10", supplierId: "sup-a", currencyCode: "XYZ" })
  ).toEqual({ action: "error", reason: 'Currency Code "XYZ" not found' });
});

it("refuses a second row for the same item and supplier", () => {
  expect(
    classify(
      { readableId: "BRK-10", supplierId: "sup-a" },
      new Set([supplierPartKey("part-1", "sup-a")])
    )
  ).toEqual({
    action: "error",
    reason: "Duplicate supplier part for BRK-10 rev 0 and this supplier in file"
  });
  expect(
    classify(
      { readableId: "BRK-10", supplierId: "sup-b" },
      new Set([supplierPartKey("part-1", "sup-a")])
    )
  ).toMatchObject({ action: "write", supplierId: "sup-b" });
});

it("refuses a missing supplier and items without a Purchasing tab", () => {
  expect(classify({ readableId: "BRK-10", supplierId: " " })).toEqual({
    action: "error",
    reason: "Missing required Supplier"
  });
  expect(classify({ readableId: "FX-1", supplierId: "sup-a" })).toEqual({
    action: "error",
    reason:
      "Item FX-1 rev 0 is a Fixture; this import takes Part, Material, Tool, Consumable, Service items"
  });
});
