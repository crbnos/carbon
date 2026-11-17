// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type BuildableBom,
  type BuildableItemInfo,
  computeBuildable
} from "./buildable.ts";

type Line = [
  parent: string,
  child: string,
  quantity: number,
  options?: { unit?: string; makeToOrder?: boolean }
];

const bomOf = (lines: Line[]): BuildableBom => {
  const bom: BuildableBom = new Map();
  for (const [parent, child, quantity, options] of lines) {
    bom.set(parent, [
      ...(bom.get(parent) ?? []),
      {
        itemId: child,
        quantity,
        unitOfMeasureCode: options?.unit ?? "EA",
        makeToOrder: options?.makeToOrder ?? false
      }
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

  it("refuses a BOM that contains itself, and names the items", () => {
    const result = run(
      [
        ["FG", "S", 1],
        ["S", "T", 1],
        ["T", "S", 1],
        ["T", "RAW", 1]
      ],
      { S: 2, T: 1, RAW: 5 }
    );
    expect(result.quantityBuildable).toBeNull();
    expect(result.components).toEqual([]);
    expect(result.cycleItems.map((c) => c.itemId).sort()).toEqual([
      "RAW",
      "S",
      "T"
    ]);
  });

  it("refuses a BOM whose root is on the cycle", () => {
    const result = run(
      [
        ["FG", "S", 1],
        ["S", "FG", 1]
      ],
      { S: 5 }
    );
    expect(result.quantityBuildable).toBeNull();
    expect(result.cycleItems.map((c) => c.itemId).sort()).toEqual(["FG", "S"]);
  });

  it("rounds scrap on each line, as each job material line rounds it", () => {
    // C (10% scrap) on S1 and on S2. At 5: each line 5 + ceil(0.5) = 6, so
    // 12 C, not 10 + ceil(1) = 11 from one rounding of the sum.
    const lines: Line[] = [
      ["FG", "S1", 1],
      ["FG", "S2", 1],
      ["S1", "C", 1],
      ["S2", "C", 1]
    ];
    expect(run(lines, { C: 11 }, undefined, { C: 0.1 }).quantityBuildable).toBe(
      4
    );
    const at5 = run(lines, { C: 12 }, undefined, { C: 0.1 });
    expect(at5.quantityBuildable).toBe(5);
    expect(at5.components.find((c) => c.itemId === "C")).toMatchObject({
      quantityRequired: 14,
      quantityScrap: 2
    });
  });

  it("builds a Make to Order subassembly instead of drawing its stock", () => {
    const lines = (makeToOrder: boolean): Line[] => [
      ["FG", "SUB", 1, { makeToOrder }],
      ["SUB", "RAW", 1]
    ];
    const stock = { SUB: 10, RAW: 3 };
    expect(run(lines(false), stock).quantityBuildable).toBe(13);
    const mto = run(lines(true), stock);
    expect(mto.quantityBuildable).toBe(3);
    expect(mto.components.find((c) => c.itemId === "SUB")).toMatchObject({
      quantityFromStock: 0,
      quantityToBuild: 4
    });
  });

  it("draws a Make to Order line's stock when the child is not made", () => {
    const result = run([["FG", "A", 1, { makeToOrder: true }]], { A: 4 });
    expect(result.quantityBuildable).toBe(4);
  });

  it("gives each bought item its own limit, the most limiting first", () => {
    // A alone allows 10 (B unlimited); B alone allows 4 + 2 from SUB stock = 6.
    const result = run(
      [
        ["FG", "A", 1],
        ["FG", "SUB", 1],
        ["SUB", "B", 1]
      ],
      { A: 10, SUB: 2, B: 4 }
    );
    expect(result.quantityBuildable).toBe(6);
    expect(
      result.components.map((c) => [c.itemId, c.quantityBuildableAlone])
    ).toEqual([
      ["B", 6],
      ["A", 10],
      ["SUB", null]
    ]);
  });

  it("adds a pulled subassembly's scrap, then its own job's scrap to build the shortfall", () => {
    // 10% scrap on SUB, none in stock. 10 FG consume 10 + ceil(1) = 11 SUB;
    // the job that makes them starts 11 + ceil(1.1) = 13, so 26 RAW.
    const result = run(
      [
        ["FG", "SUB", 1],
        ["SUB", "RAW", 2]
      ],
      { RAW: 22 },
      10,
      { SUB: 0.1 }
    );
    expect(result.quantityBuildable).toBe(9);
    expect(result.components.find((c) => c.itemId === "SUB")).toMatchObject({
      quantityPerAssembly: 1,
      quantityScrap: 3,
      quantityRequired: 13,
      quantityToBuild: 13
    });
    expect(result.components.find((c) => c.itemId === "RAW")).toMatchObject({
      quantityRequired: 26,
      quantityShort: 4
    });
  });

  it("adds a Make to Order subassembly's scrap once, as the job builds it", () => {
    // 10 FG build 10 + ceil(1) = 11 SUB inside the job, so 22 RAW.
    const result = run(
      [
        ["FG", "SUB", 1, { makeToOrder: true }],
        ["SUB", "RAW", 2]
      ],
      { RAW: 22 },
      10,
      { SUB: 0.1 }
    );
    expect(result.quantityBuildable).toBe(10);
    expect(result.components.find((c) => c.itemId === "SUB")).toMatchObject({
      quantityScrap: 1,
      quantityToBuild: 11
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
        ["FG", "B", 2, { unit: "LB" }]
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
