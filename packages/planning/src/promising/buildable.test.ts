// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type BuildableBom,
  type BuildableItemInfo,
  computeBuildable
} from "./buildable.ts";

type Line = [parent: string, child: string, quantity: number, unit?: string];

const bomOf = (lines: Line[]): BuildableBom => {
  const bom: BuildableBom = new Map();
  for (const [parent, child, quantity, unit = "EA"] of lines) {
    bom.set(parent, [
      ...(bom.get(parent) ?? []),
      { itemId: child, quantity, unitOfMeasureCode: unit }
    ]);
  }
  return bom;
};

// Every item in the BOM, stocked in EA with no scrap unless given.
const itemsOf = (
  lines: Line[],
  stock: Record<string, number | [number, number]>,
  scrap: Record<string, number>
): Map<string, BuildableItemInfo> => {
  const ids = new Set(["FG", ...Object.keys(stock)]);
  for (const [parent, child] of lines) ids.add(parent).add(child);
  return new Map(
    Array.from(ids, (id) => {
      const value = stock[id] ?? 0;
      const [onHand, committed] = Array.isArray(value) ? value : [value, 0];
      return [
        id,
        {
          readableId: id,
          name: id,
          unitOfMeasureCode: "EA",
          scrapPercentage: scrap[id] ?? 0,
          quantityOnHand: onHand,
          quantityCommitted: committed,
          quantityOnOrder: 0
        }
      ];
    })
  );
};

const run = (
  lines: Line[],
  stock: Record<string, number | [number, number]>,
  targetQuantity?: number,
  scrap: Record<string, number> = {}
) =>
  computeBuildable({
    itemId: "FG",
    locationId: "L",
    bom: bomOf(lines),
    items: itemsOf(lines, stock, scrap),
    targetQuantity
  });

describe("computeBuildable", () => {
  it("takes the scarcest component on a single level", () => {
    const result = run(
      [
        ["FG", "A", 2],
        ["FG", "B", 3]
      ],
      { A: 10, B: 9 }
    );
    expect(result.quantityBuildable).toBe(3);
    expect(result.components[0]).toMatchObject({
      itemId: "B",
      quantityBuildableAlone: 3,
      quantityShort: 3
    });
    // At 4: A needs 8 of 10 (fine), B needs 12 of 9.
    expect(result.targetQuantity).toBe(4);
  });

  it("uses a subassembly's stock before building it from its children", () => {
    const result = run(
      [
        ["FG", "SUB", 1],
        ["SUB", "RAW", 2]
      ],
      { SUB: 5, RAW: 10 }
    );
    // 5 from SUB stock + 10 / 2 built.
    expect(result.quantityBuildable).toBe(10);
    const sub = result.components.find((c) => c.itemId === "SUB");
    expect(sub).toMatchObject({ isMade: true, quantityFromStock: 5 });
  });

  it("nets a component shared by two subassemblies once, not per path", () => {
    // Naive min-of-children says 10 for each of S1 and S2; they share RAW.
    const result = run(
      [
        ["FG", "S1", 1],
        ["FG", "S2", 1],
        ["S1", "RAW", 1],
        ["S2", "RAW", 1]
      ],
      { RAW: 10 }
    );
    expect(result.quantityBuildable).toBe(5);
    const raw = result.components.find((c) => c.itemId === "RAW");
    expect(raw?.quantityPerAssembly).toBe(2);
    expect(raw?.level).toBe(2);
  });

  it("keeps committed stock with its orders, and reports what using it would allow", () => {
    const result = run([["FG", "A", 1]], { A: [10, 4] });
    expect(result.quantityBuildable).toBe(6);
    expect(result.quantityBuildableFromOnHand).toBe(10);
  });

  it("reports shortages at an asked quantity", () => {
    const result = run(
      [
        ["FG", "A", 1],
        ["FG", "B", 1]
      ],
      { A: 3, B: 100 },
      50
    );
    expect(result.targetQuantity).toBe(50);
    const a = result.components.find((c) => c.itemId === "A");
    expect(a).toMatchObject({ quantityRequired: 50, quantityShort: 47 });
    expect(result.components.find((c) => c.itemId === "B")?.quantityShort).toBe(
      0
    );
  });

  it("does not read float error as a shortage", () => {
    const result = run([["FG", "A", 0.1]], { A: 3 });
    expect(result.quantityBuildable).toBe(30);
  });

  it("returns 0 without a make method", () => {
    const result = run([], { FG: 4 });
    expect(result).toMatchObject({
      hasMakeMethod: false,
      quantityBuildable: 0,
      quantityOnHand: 4
    });
  });

  it("stops on a cycle", () => {
    const result = run(
      [
        ["FG", "S", 1],
        ["S", "T", 1],
        ["T", "S", 1]
      ],
      { S: 2, T: 1 }
    );
    expect(result.cycleItemIds.length).toBeGreaterThan(0);
    expect(result.quantityBuildable).toBe(2);
  });

  it("adds scrap as a job does: whole units up, children exploded from the total", () => {
    // 10% scrap on SUB: 10 SUB need ceil(1) = 11 built, so 22 RAW.
    const result = run(
      [
        ["FG", "SUB", 1],
        ["SUB", "RAW", 2]
      ],
      { RAW: 22 },
      10,
      { SUB: 0.1 }
    );
    expect(result.quantityBuildable).toBe(10);
    const sub = result.components.find((c) => c.itemId === "SUB");
    expect(sub).toMatchObject({
      quantityPerAssembly: 1,
      quantityScrap: 1,
      quantityRequired: 11,
      quantityToBuild: 11
    });
    expect(result.components.find((c) => c.itemId === "RAW")).toMatchObject({
      quantityRequired: 22,
      quantityShort: 0
    });
  });

  it("scraps the finished good itself before exploding it", () => {
    // 5% on FG: 20 need ceil(1) = 21 built, so 21 A.
    const result = run([["FG", "A", 1]], { A: 20 }, undefined, { FG: 0.05 });
    expect(result.quantityBuildable).toBe(19);
  });

  it("refuses a line whose unit is not its item's stock unit", () => {
    const result = run(
      [
        ["FG", "A", 1],
        ["FG", "B", 2, "LB"]
      ],
      { A: 10, B: 100 }
    );
    expect(result.quantityBuildable).toBeNull();
    expect(result.quantityBuildableFromOnHand).toBeNull();
    expect(result.components).toEqual([]);
    expect(result.unitMismatches).toEqual([
      {
        parentItemId: "FG",
        parentReadableId: "FG",
        itemId: "B",
        readableId: "B",
        lineUnitOfMeasureCode: "LB",
        stockUnitOfMeasureCode: "EA"
      }
    ]);
  });
});
