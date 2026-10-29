// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { PivotGroupRow } from "./pivotData";
import {
  applyPercentOfTotal,
  buildPivotTree,
  getPivotMeasureValue,
  LABEL_SORT_KEY,
  pivotToCsvRows,
  TOTAL_SORT_KEY,
  UNASSIGNED_COLUMN_KEY
} from "./pivotData";

function group(
  rowValue1Id: string | null,
  rowValue2Id: string | null,
  columnKey: string | null,
  amount: number,
  quantity = 0,
  lineCount = 1
): PivotGroupRow {
  return { rowValue1Id, rowValue2Id, columnKey, amount, quantity, lineCount };
}

type BuildArgs = Parameters<typeof buildPivotTree>[0];

function build(groups: PivotGroupRow[], overrides: Partial<BuildArgs> = {}) {
  return buildPivotTree({
    groups,
    valueNames: { a: "Alpha", b: "Beta", x: "X-Ray", y: "Yankee", z: "Zulu" },
    columnKeys: ["c1", "c2"],
    rowCount: 1,
    measure: "amount",
    ...overrides
  });
}

const cell = (amount: number, quantity: number, lineCount: number) => ({
  amount,
  quantity,
  lineCount
});

describe("buildPivotTree", () => {
  it("sorts one-dimension rows by ABS(measure) desc with Unassigned last", () => {
    const result = build([
      group("a", null, "c1", 100, 5, 2),
      group("a", null, "c2", 50, 1, 1),
      group("b", null, "c1", -400, 2, 3),
      group("b", null, "c2", 100, 0, 1),
      // The biggest ABS total, but Unassigned still sorts last.
      group(null, null, "c1", 900, 9, 4)
    ]);

    expect(result.columnsTruncated).toBe(false);
    expect(result.columnKeys).toEqual(["c1", "c2"]);
    // Beta |−300| before Alpha |150|.
    expect(result.flatTree.map((n) => n.data.label)).toEqual([
      "Beta",
      "Alpha",
      "Unassigned"
    ]);
    expect(result.flatTree[0]).toMatchObject({
      id: "b",
      parentId: undefined,
      level: 0,
      hasChildren: false,
      children: [],
      data: {
        rowValue1Id: "b",
        rowValue2Id: null,
        isUnassigned: false,
        total: cell(-300, 2, 4),
        cells: { c1: cell(-400, 2, 3), c2: cell(100, 0, 1) }
      }
    });
    expect(result.flatTree[2]?.data).toMatchObject({
      isUnassigned: true,
      rowValue1Id: null,
      total: { amount: 900 }
    });
  });

  it("labels a row by its raw id when valueNames has no entry", () => {
    expect(
      build([group("mystery", null, "c1", 10)]).flatTree[0]?.data.label
    ).toBe("mystery");
  });

  it("nests two dimensions with parent subtotals over their children", () => {
    const result = build(
      [
        group("a", "x", "c1", 100, 2, 1),
        group("a", "x", "c2", 50, 1, 1),
        group("a", "y", "c1", 300, 3, 2),
        group("a", null, "c1", 25, 0, 1),
        group("b", "x", "c1", 10, 1, 1)
      ],
      { rowCount: 2 }
    );

    // Alpha 475 before Beta 10; Alpha's children Yankee 300, X-Ray 150, then
    // Unassigned 25 last regardless of size.
    expect(result.flatTree.map((n) => [n.id, n.parentId, n.level])).toEqual([
      ["a", undefined, 0],
      ["a|y", "a", 1],
      ["a|x", "a", 1],
      ["a|__unassigned__", "a", 1],
      ["b", undefined, 0],
      ["b|x", "b", 1]
    ]);
    expect(result.flatTree[0]).toMatchObject({
      hasChildren: true,
      children: ["a|y", "a|x", "a|__unassigned__"],
      data: {
        rowValue1Id: "a",
        rowValue2Id: null,
        total: cell(475, 6, 5),
        cells: { c1: { amount: 425 }, c2: { amount: 50 } }
      }
    });
    expect(result.flatTree[3]?.data).toMatchObject({
      rowValue1Id: "a",
      rowValue2Id: null,
      isUnassigned: true
    });
  });

  it("totals each column, including the Unassigned column, and the grand total", () => {
    const result = build(
      [
        group("a", null, "c1", 100, 2, 1),
        group("b", null, "c1", -40, 1, 2),
        group("a", null, "c2", 60, 3, 1),
        group(null, null, null, 5, 1, 1)
      ],
      { columnKeys: ["c1", "c2", UNASSIGNED_COLUMN_KEY] }
    );

    expect(result.columnTotals).toEqual({
      c1: cell(60, 3, 3),
      c2: cell(60, 3, 1),
      [UNASSIGNED_COLUMN_KEY]: cell(5, 1, 1)
    });
    expect(result.grandTotal).toEqual(cell(125, 7, 5));
  });

  it("collapses to a single labelled total row when no row dimension is chosen", () => {
    const groups = [
      group("a", null, "c1", 100, 2, 1),
      group("b", null, "c2", 50, 1, 1)
    ];
    const result = build(groups, { rowCount: 0 });

    expect(result.flatTree).toHaveLength(1);
    expect(result.flatTree[0]).toMatchObject({
      id: "total",
      level: 0,
      parentId: undefined,
      hasChildren: false,
      data: {
        key: "total",
        label: "Total",
        isUnassigned: false,
        total: cell(150, 3, 2),
        cells: { c1: { amount: 100 }, c2: { amount: 50 } }
      }
    });
    expect(
      build(groups, { rowCount: 0, totalLabel: "Gesamt" }).flatTree[0]?.data
        .label
    ).toBe("Gesamt");
  });

  it("uses the caller's localized Unassigned label", () => {
    expect(
      build([group(null, null, "c1", 10)], {
        unassignedLabel: "Nicht zugewiesen"
      }).flatTree[0]?.data.label
    ).toBe("Nicht zugewiesen");
  });

  it("keeps the top columns by ABS(measure) plus Unassigned, with totals over all data", () => {
    const result = build(
      [
        group("a", null, "c1", 1000, 1, 1),
        group("a", null, "c2", 10, 1, 1),
        group("a", null, "c3", -500, 1, 1),
        group("a", null, null, 1, 1, 1)
      ],
      { columnKeys: ["c1", "c2", "c3", UNASSIGNED_COLUMN_KEY], maxColumns: 2 }
    );

    expect(result.columnsTruncated).toBe(true);
    // c1 is the top column by ABS; Unassigned stays though it is the smallest.
    expect(result.columnKeys).toEqual(["c1", UNASSIGNED_COLUMN_KEY]);
    expect(Object.keys(result.flatTree[0]?.data.cells ?? {})).toEqual([
      "c1",
      UNASSIGNED_COLUMN_KEY
    ]);
    // Hidden columns still count: 1000 + 10 − 500 + 1.
    expect(result.flatTree[0]?.data.total.amount).toBe(511);
    expect(result.grandTotal.amount).toBe(511);
    expect(result.columnTotals.c3?.amount).toBe(-500);
  });

  it("ranks columns for truncation by the chosen measure", () => {
    const result = build(
      [group("a", null, "c1", 1000, 1, 1), group("a", null, "c2", 10, 900, 1)],
      { measure: "quantity", maxColumns: 1 }
    );
    expect(result.columnKeys).toEqual(["c2"]);
  });

  it("does not cap columns when maxColumns is omitted", () => {
    const columnKeys = Array.from({ length: 120 }, (_, i) => `c${i}`);
    const result = build(
      columnKeys.map((key, i) => group("a", null, key, i + 1)),
      { columnKeys }
    );
    expect(result.columnsTruncated).toBe(false);
    expect(result.columnKeys).toEqual(columnKeys);
  });

  it.each([
    // A column sort is signed, not ABS.
    ["c1", "desc", ["Zulu", "Alpha", "Beta"]],
    ["c1", "asc", ["Beta", "Alpha", "Zulu"]],
    [LABEL_SORT_KEY, "asc", ["Alpha", "Beta", "Zulu"]],
    [LABEL_SORT_KEY, "desc", ["Zulu", "Beta", "Alpha"]],
    [TOTAL_SORT_KEY, "asc", ["Beta", "Alpha", "Zulu"]]
  ] as const)("sorts rows by %s %s", (key, direction, labels) => {
    const result = build(
      [
        group("a", null, "c1", 100),
        group("b", null, "c1", -300),
        group("z", null, "c1", 200),
        group(null, null, "c1", 999)
      ],
      { columnKeys: ["c1"], sort: { key, direction } }
    );
    // Unassigned stays last under every explicit sort.
    expect(result.flatTree.map((n) => n.data.label)).toEqual([
      ...labels,
      "Unassigned"
    ]);
  });

  it("applies the sort within a nested level", () => {
    const result = build(
      [
        group("a", "x", "c1", 100),
        group("a", "y", "c1", 300),
        group("a", "z", "c1", 200)
      ],
      { columnKeys: ["c1"], rowCount: 2, sort: { key: "c1", direction: "asc" } }
    );
    expect(
      result.flatTree
        .filter((n) => n.parentId === "a")
        .map((n) => n.data.rowValue2Id)
    ).toEqual(["x", "z", "y"]);
  });
});

describe("applyPercentOfTotal", () => {
  it("splits a column 25/75 and reads 0% in a column that nets to zero", () => {
    const result = build(
      [
        group("a", null, "c1", 25),
        group("b", null, "c1", 75),
        group("a", null, "c0", 100),
        group("b", null, "c0", -100)
      ],
      { columnKeys: ["c1", "c0"] }
    );
    expect(
      result.flatTree.map((node) =>
        applyPercentOfTotal(node.data.cells, result.columnTotals, "amount")
      )
    ).toEqual([
      { c1: 25, c0: 0 },
      { c1: 75, c0: 0 }
    ]);
  });

  it("measures count as lineCount", () => {
    expect(
      applyPercentOfTotal(
        { c1: cell(0, 0, 3) },
        { c1: cell(0, 0, 12) },
        "count"
      )
    ).toEqual({ c1: 25 });
  });
});

it.each([
  ["amount", 1],
  ["quantity", 2],
  ["count", 3]
] as const)("getPivotMeasureValue reads %s", (measure, expected) => {
  expect(getPivotMeasureValue(cell(1, 2, 3), measure)).toBe(expected);
  expect(getPivotMeasureValue(undefined, measure)).toBe(0);
});

describe("pivotToCsvRows", () => {
  const csv = (
    built: ReturnType<typeof build>,
    columnLabels: Record<string, string>
  ) =>
    pivotToCsvRows({
      flatTree: built.flatTree,
      columnKeys: built.columnKeys,
      columnTotals: built.columnTotals,
      grandTotal: built.grandTotal,
      measure: "amount",
      columnLabels
    });

  it("writes the rendered tree with a header, indented children and a totals row", () => {
    const built = build(
      [
        group("a", "x", "c1", 100),
        group("a", "y", "c1", 300),
        group("a", "x", "c2", 50),
        group(null, null, "c1", 5)
      ],
      { rowCount: 2 }
    );
    expect(csv(built, { c1: "Jan 2026", c2: "Feb 2026" })).toEqual([
      ["", "Jan 2026", "Feb 2026", "Total"],
      ["Alpha", "400", "50", "450"],
      ["  Yankee", "300", "0", "300"],
      ["  X-Ray", "100", "50", "150"],
      ["Unassigned", "5", "0", "5"],
      ["  Unassigned", "5", "0", "5"],
      ["Total", "405", "50", "455"]
    ]);
  });

  it("heads a column by its raw key when it has no label", () => {
    const built = build([group("a", null, "c1", 10)], { columnKeys: ["c1"] });
    expect(csv(built, {})).toEqual([
      ["", "c1", "Total"],
      ["Alpha", "10", "10"],
      ["Total", "10", "10"]
    ]);
  });
});
