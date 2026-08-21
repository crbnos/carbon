import { describe, expect, it } from "vitest";
import { resolveCartLines } from "./resolve";
import type { PunchoutCart, PunchoutCartLine } from "./types";

const line = (overrides: Partial<PunchoutCartLine>): PunchoutCartLine => ({
  supplierPartId: "3201T16",
  supplierPartAuxiliaryId: "8310486455458",
  quantity: 2,
  unitPrice: 0.9,
  currencyCode: "USD",
  description: "U-Bolt",
  unitOfMeasureCode: "EA",
  classification: null,
  manufacturerPartId: null,
  manufacturerName: null,
  ...overrides
});

const cart = (lines: PunchoutCartLine[]): PunchoutCart => ({
  buyerCookie: "c",
  total: null,
  currencyCode: "USD",
  operationAllowed: "create",
  lines
});

describe("resolveCartLines", () => {
  it("resolves a matched supplier part to a Part line with cross-reference UOM", () => {
    const [resolved] = resolveCartLines({
      cart: cart([line({})]),
      supplierParts: [
        {
          supplierPartId: "3201T16",
          itemId: "item-1",
          supplierUnitOfMeasureCode: "BOX",
          conversionFactor: 10,
          inventoryUnitOfMeasureCode: "EA"
        }
      ],
      uomCodes: ["EA", "BOX"],
      defaultExpenseAccountId: "acc-1"
    });
    expect(resolved?.purchaseOrderLineType).toBe("Part");
    expect(resolved?.itemId).toBe("item-1");
    expect(resolved?.accountId).toBeNull();
    expect(resolved?.purchaseUnitOfMeasureCode).toBe("BOX");
    expect(resolved?.conversionFactor).toBe(10);
    expect(resolved?.supplierUnitPrice).toBe(0.9);
    expect(resolved?.supplierPartAuxiliaryId).toBe("8310486455458");
    expect(resolved?.issues).toEqual([]);
  });

  it("matches supplier part id case-insensitively", () => {
    const [resolved] = resolveCartLines({
      cart: cart([line({ supplierPartId: "3201t16" })]),
      supplierParts: [
        {
          supplierPartId: "3201T16",
          itemId: "item-1",
          supplierUnitOfMeasureCode: null,
          conversionFactor: null
        }
      ],
      uomCodes: ["EA"],
      defaultExpenseAccountId: "acc-1"
    });
    expect(resolved?.purchaseOrderLineType).toBe("Part");
    expect(resolved?.itemId).toBe("item-1");
    expect(resolved?.conversionFactor).toBe(1);
  });

  it("falls back to a G/L Account line when the part is unmatched", () => {
    const [resolved] = resolveCartLines({
      cart: cart([line({ supplierPartId: "UNKNOWN", description: "Mystery" })]),
      supplierParts: [],
      uomCodes: ["EA"],
      defaultExpenseAccountId: "acc-expense"
    });
    expect(resolved?.purchaseOrderLineType).toBe("G/L Account");
    expect(resolved?.itemId).toBeNull();
    expect(resolved?.accountId).toBe("acc-expense");
    expect(resolved?.description).toBe("Mystery");
    expect(resolved?.supplierPartId).toBe("UNKNOWN");
  });

  it("defaults an unmapped UOM to EA and records an issue", () => {
    const [resolved] = resolveCartLines({
      cart: cart([
        line({ supplierPartId: "UNKNOWN", unitOfMeasureCode: "PR" })
      ]),
      supplierParts: [],
      uomCodes: ["EA"],
      defaultExpenseAccountId: "acc-expense"
    });
    expect(resolved?.purchaseUnitOfMeasureCode).toBe("EA");
    expect(resolved?.issues).toEqual([
      'Unmapped unit of measure "PR" — defaulted to EA'
    ]);
  });

  it("returns [] for an empty cart", () => {
    expect(
      resolveCartLines({
        cart: cart([]),
        supplierParts: [],
        uomCodes: ["EA"],
        defaultExpenseAccountId: "acc-1"
      })
    ).toEqual([]);
  });
});
