// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";

import {
  getRfqLinesFromMethod,
  groupRequestQuoteLines,
  toPurchaseQuantity
} from "./purchasing.models";

describe("getRfqLinesFromMethod", () => {
  const row = (
    methodMaterialId: string,
    parentMaterialId: string,
    itemReadableId: string,
    quantity: number,
    methodType = "Pull from Inventory",
    replenishmentSystem = "Buy",
    isPickDescendant = false
  ) => ({
    methodMaterialId,
    parentMaterialId,
    itemId: itemReadableId,
    itemReadableId,
    description: itemReadableId,
    unitOfMeasureCode: "EA",
    quantity,
    methodType,
    replenishmentSystem,
    isPickDescendant
  });

  // The shape of EPS-001 in the satellite dataset.
  const tree = [
    {
      ...row("root", "", "EPS-001", 1, "Make to Order", "Make"),
      parentMaterialId: null
    },
    row("saw", "root", "SAW-001", 2, "Make to Order", "Make"),
    row("cell", "saw", "MAT-GAAS-CELL", 64),
    row("tape1", "saw", "MAT-KAPTON", 2.5),
    row("bat", "root", "BAT-LIION-48V", 1),
    row("tape2", "root", "MAT-KAPTON", 1)
  ];
  const lines = getRfqLinesFromMethod(tree, "root", "EPS-001");
  const line = (id: string) => lines.find((l) => l.itemId === id);

  it("multiplies a child by its parent", () => {
    expect(line("MAT-GAAS-CELL")?.quantity).toBe(128);
  });

  it("adds up repeats and names each parent", () => {
    expect(line("MAT-KAPTON")?.quantity).toBe(6);
    expect(line("MAT-KAPTON")?.usedIn).toEqual(["SAW-001", "EPS-001"]);
  });

  it("leaves out a line with no quantity, and what is under it", () => {
    const result = getRfqLinesFromMethod(
      [
        row("zero", "root", "OPTION-A", 0),
        row("asm", "root", "ASM-OFF", 0, "Make to Order", "Make"),
        row("inner", "asm", "BOLT", 4)
      ],
      "root",
      "TOP"
    );
    expect(result).toEqual([]);
  });

  it("does not list a Make to Order line", () => {
    expect(line("SAW-001")).toBeUndefined();
    expect(line("EPS-001")).toBeUndefined();
  });

  it("adds up a sub-assembly used under two parents", () => {
    const result = getRfqLinesFromMethod(
      [
        row("a", "root", "ASM-A", 2, "Make to Order", "Make"),
        row("b", "root", "ASM-B", 3, "Make to Order", "Make"),
        row("shared-a", "a", "SUB", 1, "Make to Order", "Make"),
        row("shared-b", "b", "SUB", 1, "Make to Order", "Make"),
        row("bolt-a", "shared-a", "BOLT", 4),
        row("bolt-b", "shared-b", "BOLT", 4)
      ],
      "root",
      "TOP"
    );
    expect(result.map((l) => [l.itemId, l.quantity])).toEqual([["BOLT", 20]]);
  });

  it("rounds away float noise", () => {
    const result = getRfqLinesFromMethod(
      [
        row("sub", "root", "SUB", 3, "Make to Order", "Make"),
        row("tape", "sub", "TAPE", 0.1)
      ],
      "root",
      "TOP"
    );
    expect(result[0]?.quantity).toBe(0.3);
  });

  it("lists a Make to Order line with no method that can be bought", () => {
    const result = getRfqLinesFromMethod(
      [row("bought", "root", "BOUGHT", 2, "Make to Order", "Buy and Make")],
      "root",
      "TOP"
    );
    expect(result.map((l) => l.itemId)).toEqual(["BOUGHT"]);
  });

  it("skips a stocked part that is only made, and its contents", () => {
    const result = getRfqLinesFromMethod(
      [
        row("sub", "root", "SUB-1", 1, "Pull from Inventory", "Make"),
        row("inner", "sub", "INNER-1", 1, "Pull from Inventory", "Buy", true)
      ],
      "root",
      "TOP"
    );
    expect(result).toEqual([]);
  });
});

describe("toPurchaseQuantity", () => {
  it("rounds up to whole purchase units", () => {
    expect(toPurchaseQuantity(45, 10)).toBe(5);
    expect(toPurchaseQuantity(40, 10)).toBe(4);
  });

  it("does not round a float error up a whole unit", () => {
    expect(toPurchaseQuantity(1.1, 0.1)).toBe(11);
  });

  it("keeps a fraction in the inventory unit, without float noise", () => {
    expect(toPurchaseQuantity(0.1 * 3, 1)).toBe(0.3);
  });
});

describe("groupRequestQuoteLines", () => {
  const line = (itemId: string, supplierIds: string[]) => ({
    itemId,
    quantity: 1,
    supplierIds
  });

  it("makes one group per supplier", () => {
    const groups = groupRequestQuoteLines([
      line("A", ["s1"]),
      line("B", ["s2"]),
      line("C", ["s1"])
    ]);
    expect(groups.map((g) => g.lines.map((l) => l.itemId))).toEqual([
      ["A", "C"],
      ["B"]
    ]);
  });

  it("keeps a line's suppliers together, in any order", () => {
    const groups = groupRequestQuoteLines([
      line("A", ["s1", "s2"]),
      line("B", ["s2", "s1"])
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.supplierIds).toEqual(["s1", "s2"]);
  });
});
