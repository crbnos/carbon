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

const VALUE_NAMES: Record<string, string> = {
  a: "Alpha",
  b: "Beta",
  x: "X-Ray",
  y: "Yankee"
};

describe("buildPivotTree", () => {
  it("1-dim rows: sorts by ABS(measure) desc, Unassigned last, totals correct", () => {
    const groups = [
      group("a", null, "c1", 100, 5, 2),
      group("a", null, "c2", 50, 1, 1),
      group("b", null, "c1", -400, 2, 3),
      group("b", null, "c2", 100, 0, 1),
      // Unassigned row has the biggest ABS total but must still sort last.
      group(null, null, "c1", 900, 9, 4)
    ];

    const result = buildPivotTree({
      groups,
      valueNames: VALUE_NAMES,
      columnKeys: ["c1", "c2"],
      rowCount: 1,
      measure: "amount"
    });

    expect(result.flatTree).toHaveLength(3);
    expect(result.flatTree.map((n) => n.data.label)).toEqual([
      "Beta", // ABS(-300) > ABS(150)
      "Alpha",
      "Unassigned"
    ]);
    expect(result.columnsTruncated).toBe(false);
    expect(result.columnKeys).toEqual(["c1", "c2"]);

    const beta = result.flatTree[0];
    expect(beta?.id).toBe("b");
    expect(beta?.parentId).toBeUndefined();
    expect(beta?.level).toBe(0);
    expect(beta?.hasChildren).toBe(false);
    expect(beta?.children).toEqual([]);
    expect(beta?.data.rowValue1Id).toBe("b");
    expect(beta?.data.rowValue2Id).toBeNull();
    expect(beta?.data.isUnassigned).toBe(false);
    expect(beta?.data.total).toEqual({
      amount: -300,
      quantity: 2,
      lineCount: 4
    });
    expect(beta?.data.cells["c1"]).toEqual({
      amount: -400,
      quantity: 2,
      lineCount: 3
    });
    expect(beta?.data.cells["c2"]).toEqual({
      amount: 100,
      quantity: 0,
      lineCount: 1
    });

    const unassigned = result.flatTree[2];
    expect(unassigned?.data.isUnassigned).toBe(true);
    expect(unassigned?.data.rowValue1Id).toBeNull();
    expect(unassigned?.data.total.amount).toBe(900);
  });

  it("falls back to the raw id when a valueNames entry is missing", () => {
    const result = buildPivotTree({
      groups: [group("mystery", null, "c1", 10)],
      valueNames: {},
      columnKeys: ["c1"],
      rowCount: 1,
      measure: "amount"
    });
    expect(result.flatTree[0]?.data.label).toBe("mystery");
  });

  it("2-dim nesting: parent subtotals equal sum of children; levels and parentId wired", () => {
    const groups = [
      group("a", "x", "c1", 100, 2, 1),
      group("a", "x", "c2", 50, 1, 1),
      group("a", "y", "c1", 300, 3, 2),
      group("a", null, "c1", 25, 0, 1), // Unassigned child under Alpha
      group("b", "x", "c1", 10, 1, 1)
    ];

    const result = buildPivotTree({
      groups,
      valueNames: VALUE_NAMES,
      columnKeys: ["c1", "c2"],
      rowCount: 2,
      measure: "amount"
    });

    // Alpha (475) before Beta (10); Alpha's children: Yankee (300), X-Ray (150),
    // Unassigned (25, last regardless of size).
    expect(result.flatTree.map((n) => n.id)).toEqual([
      "a",
      "a|y",
      "a|x",
      "a|__unassigned__",
      "b",
      "b|x"
    ]);

    const alpha = result.flatTree[0];
    expect(alpha?.level).toBe(0);
    expect(alpha?.parentId).toBeUndefined();
    expect(alpha?.hasChildren).toBe(true);
    expect(alpha?.children).toEqual(["a|y", "a|x", "a|__unassigned__"]);
    expect(alpha?.data.rowValue1Id).toBe("a");
    expect(alpha?.data.rowValue2Id).toBeNull();

    const alphaChildren = result.flatTree.filter((n) => n.parentId === "a");
    expect(alphaChildren).toHaveLength(3);
    for (const child of alphaChildren) {
      expect(child.level).toBe(1);
      expect(child.hasChildren).toBe(false);
      expect(child.data.rowValue1Id).toBe("a");
    }

    // Parent totals aggregate children.
    const childTotalSum = alphaChildren.reduce(
      (sum, child) => sum + child.data.total.amount,
      0
    );
    expect(alpha?.data.total.amount).toBe(childTotalSum);
    expect(alpha?.data.total).toEqual({
      amount: 475,
      quantity: 6,
      lineCount: 5
    });

    // Parent cells aggregate children's cells per column.
    const childC1Sum = alphaChildren.reduce(
      (sum, child) => sum + (child.data.cells["c1"]?.amount ?? 0),
      0
    );
    expect(alpha?.data.cells["c1"]?.amount).toBe(childC1Sum);
    expect(alpha?.data.cells["c1"]?.amount).toBe(425);
    expect(alpha?.data.cells["c2"]?.amount).toBe(50);

    // Unassigned leaf: rowValue2Id null, flagged.
    const unassignedLeaf = result.flatTree.find(
      (n) => n.id === "a|__unassigned__"
    );
    expect(unassignedLeaf?.data.rowValue2Id).toBeNull();
    expect(unassignedLeaf?.data.isUnassigned).toBe(true);
  });

  it("column totals and grand total are consistent with the input", () => {
    const groups = [
      group("a", null, "c1", 100, 2, 1),
      group("b", null, "c1", -40, 1, 2),
      group("a", null, "c2", 60, 3, 1),
      group(null, null, null, 5, 1, 1) // null columnKey → UNASSIGNED_COLUMN_KEY
    ];

    const result = buildPivotTree({
      groups,
      valueNames: VALUE_NAMES,
      columnKeys: ["c1", "c2", UNASSIGNED_COLUMN_KEY],
      rowCount: 1,
      measure: "amount"
    });

    expect(result.columnTotals["c1"]).toEqual({
      amount: 60,
      quantity: 3,
      lineCount: 3
    });
    expect(result.columnTotals["c2"]).toEqual({
      amount: 60,
      quantity: 3,
      lineCount: 1
    });
    expect(result.columnTotals[UNASSIGNED_COLUMN_KEY]).toEqual({
      amount: 5,
      quantity: 1,
      lineCount: 1
    });
    expect(result.grandTotal).toEqual({
      amount: 125,
      quantity: 7,
      lineCount: 5
    });

    // Grand total equals the sum of all column totals (nothing hidden here).
    const columnSum = Object.values(result.columnTotals).reduce(
      (sum, cell) => sum + cell.amount,
      0
    );
    expect(columnSum).toBe(result.grandTotal.amount);
  });

  it("rowCount 0: a single total row spanning all data", () => {
    const groups = [
      group("a", null, "c1", 100, 2, 1),
      group("b", null, "c2", 50, 1, 1)
    ];

    const result = buildPivotTree({
      groups,
      valueNames: VALUE_NAMES,
      columnKeys: ["c1", "c2"],
      rowCount: 0,
      measure: "amount"
    });

    expect(result.flatTree).toHaveLength(1);
    const totalNode = result.flatTree[0];
    expect(totalNode?.id).toBe("total");
    expect(totalNode?.data.key).toBe("total");
    expect(totalNode?.data.label).toBe("Total");
    expect(totalNode?.level).toBe(0);
    expect(totalNode?.parentId).toBeUndefined();
    expect(totalNode?.hasChildren).toBe(false);
    expect(totalNode?.data.isUnassigned).toBe(false);
    expect(totalNode?.data.total).toEqual({
      amount: 150,
      quantity: 3,
      lineCount: 2
    });
    expect(totalNode?.data.cells["c1"]?.amount).toBe(100);
    expect(totalNode?.data.cells["c2"]?.amount).toBe(50);

    // Localized total label is honored.
    const localized = buildPivotTree({
      groups,
      valueNames: VALUE_NAMES,
      columnKeys: ["c1", "c2"],
      rowCount: 0,
      measure: "amount",
      totalLabel: "Gesamt"
    });
    expect(localized.flatTree[0]?.data.label).toBe("Gesamt");
  });

  it("honors a localized unassignedLabel", () => {
    const result = buildPivotTree({
      groups: [group(null, null, "c1", 10)],
      valueNames: {},
      columnKeys: ["c1"],
      rowCount: 1,
      measure: "amount",
      unassignedLabel: "Nicht zugewiesen"
    });
    expect(result.flatTree[0]?.data.label).toBe("Nicht zugewiesen");
    expect(result.flatTree[0]?.data.isUnassigned).toBe(true);
  });

  it("truncates columns to top-N by ABS(measure), always keeping Unassigned; totals stay truthful", () => {
    const groups = [
      group("a", null, "c1", 1000, 1, 1),
      group("a", null, "c2", 10, 1, 1),
      group("a", null, "c3", -500, 1, 1),
      group("a", null, null, 1, 1, 1) // Unassigned column, tiny total
    ];

    const result = buildPivotTree({
      groups,
      valueNames: VALUE_NAMES,
      columnKeys: ["c1", "c2", "c3", UNASSIGNED_COLUMN_KEY],
      rowCount: 1,
      measure: "amount",
      maxColumns: 2
    });

    expect(result.columnsTruncated).toBe(true);
    // Top non-unassigned column by ABS is c1 (1000 > 500 > 10); Unassigned is
    // always kept even though its total is the smallest.
    expect(result.columnKeys).toEqual(["c1", UNASSIGNED_COLUMN_KEY]);

    const alpha = result.flatTree[0];
    // Hidden columns are excluded from visible cells...
    expect(alpha?.data.cells["c2"]).toBeUndefined();
    expect(alpha?.data.cells["c3"]).toBeUndefined();
    expect(alpha?.data.cells["c1"]?.amount).toBe(1000);
    expect(alpha?.data.cells[UNASSIGNED_COLUMN_KEY]?.amount).toBe(1);
    // ...but row totals, column totals, and the grand total include ALL data.
    expect(alpha?.data.total.amount).toBe(511);
    expect(result.grandTotal.amount).toBe(511);
    expect(result.columnTotals["c2"]?.amount).toBe(10);
    expect(result.columnTotals["c3"]?.amount).toBe(-500);
  });

  it("truncates by the chosen measure, not always amount", () => {
    const groups = [
      group("a", null, "c1", 1000, 1, 1), // big amount, small quantity
      group("a", null, "c2", 10, 900, 1) // small amount, big quantity
    ];

    const result = buildPivotTree({
      groups,
      valueNames: VALUE_NAMES,
      columnKeys: ["c1", "c2"],
      rowCount: 1,
      measure: "quantity",
      maxColumns: 1
    });

    expect(result.columnsTruncated).toBe(true);
    expect(result.columnKeys).toEqual(["c2"]);
  });

  it("does not cap columns when maxColumns is omitted", () => {
    const columnKeys = Array.from({ length: 120 }, (_, i) => `c${i}`);
    const groups = columnKeys.map((key, i) => group("a", null, key, i + 1));

    const result = buildPivotTree({
      groups,
      valueNames: VALUE_NAMES,
      columnKeys,
      rowCount: 1,
      measure: "amount"
    });

    expect(result.columnsTruncated).toBe(false);
    expect(result.columnKeys).toEqual(columnKeys);
  });

  it("sorts rows by a specific column, ascending and descending (signed)", () => {
    const groups = [
      group("a", null, "c1", 100),
      group("b", null, "c1", -300),
      group("c", null, "c1", 200)
    ];

    const desc = buildPivotTree({
      groups,
      valueNames: VALUE_NAMES,
      columnKeys: ["c1"],
      rowCount: 1,
      measure: "amount",
      sort: { key: "c1", direction: "desc" }
    });
    // Signed, not ABS: 200 > 100 > -300.
    expect(desc.flatTree.map((n) => n.data.rowValue1Id)).toEqual([
      "c",
      "a",
      "b"
    ]);

    const asc = buildPivotTree({
      groups,
      valueNames: VALUE_NAMES,
      columnKeys: ["c1"],
      rowCount: 1,
      measure: "amount",
      sort: { key: "c1", direction: "asc" }
    });
    expect(asc.flatTree.map((n) => n.data.rowValue1Id)).toEqual([
      "b",
      "a",
      "c"
    ]);
  });

  it("sorts by total and keeps Unassigned last even under an explicit sort", () => {
    const groups = [
      group("a", null, "c1", 100),
      group("b", null, "c1", 300),
      group(null, null, "c1", 999) // Unassigned biggest, must still sort last
    ];

    const result = buildPivotTree({
      groups,
      valueNames: VALUE_NAMES,
      columnKeys: ["c1"],
      rowCount: 1,
      measure: "amount",
      sort: { key: TOTAL_SORT_KEY, direction: "asc" }
    });

    expect(result.flatTree.map((n) => n.data.label)).toEqual([
      "Alpha",
      "Beta",
      "Unassigned"
    ]);
  });

  it("sorts by row label alphabetically", () => {
    const groups = [group("b", null, "c1", 100), group("a", null, "c1", 100)];

    const asc = buildPivotTree({
      groups,
      valueNames: VALUE_NAMES,
      columnKeys: ["c1"],
      rowCount: 1,
      measure: "amount",
      sort: { key: LABEL_SORT_KEY, direction: "asc" }
    });
    expect(asc.flatTree.map((n) => n.data.label)).toEqual(["Alpha", "Beta"]);

    const desc = buildPivotTree({
      groups,
      valueNames: VALUE_NAMES,
      columnKeys: ["c1"],
      rowCount: 1,
      measure: "amount",
      sort: { key: LABEL_SORT_KEY, direction: "desc" }
    });
    expect(desc.flatTree.map((n) => n.data.label)).toEqual(["Beta", "Alpha"]);
  });

  it("applies the column sort within a nested level too", () => {
    const groups = [
      group("a", "x", "c1", 100),
      group("a", "y", "c1", 300),
      group("a", "z", "c1", 200)
    ];

    const result = buildPivotTree({
      groups,
      valueNames: { ...VALUE_NAMES, z: "Zulu" },
      columnKeys: ["c1"],
      rowCount: 2,
      measure: "amount",
      sort: { key: "c1", direction: "asc" }
    });

    // Children of Alpha ordered by c1 ascending: x(100), z(200), y(300).
    expect(
      result.flatTree
        .filter((n) => n.parentId === "a")
        .map((n) => n.data.rowValue2Id)
    ).toEqual(["x", "z", "y"]);
  });
});

describe("applyPercentOfTotal", () => {
  it("sums to ~100 per column and yields 0s for a zero-total column", () => {
    const groups = [
      group("a", null, "c1", 25, 0, 1),
      group("b", null, "c1", 75, 0, 1),
      // c0 nets to zero: both rows must read 0%.
      group("a", null, "c0", 100, 0, 1),
      group("b", null, "c0", -100, 0, 1)
    ];

    const result = buildPivotTree({
      groups,
      valueNames: VALUE_NAMES,
      columnKeys: ["c1", "c0"],
      rowCount: 1,
      measure: "amount"
    });

    let c1Sum = 0;
    for (const node of result.flatTree) {
      const percents = applyPercentOfTotal(
        node.data.cells,
        result.columnTotals,
        "amount"
      );
      c1Sum += percents["c1"] ?? 0;
      expect(percents["c0"]).toBe(0);
    }
    expect(Math.abs(c1Sum - 100)).toBeLessThan(1e-6);
  });

  it("uses the chosen measure (count maps to lineCount)", () => {
    const cells = { c1: { amount: 0, quantity: 0, lineCount: 3 } };
    const columnTotals = { c1: { amount: 0, quantity: 0, lineCount: 12 } };
    const percents = applyPercentOfTotal(cells, columnTotals, "count");
    expect(percents["c1"]).toBe(25);
  });
});

describe("getPivotMeasureValue", () => {
  it("maps each measure and treats a missing cell as 0", () => {
    const cell = { amount: 1, quantity: 2, lineCount: 3 };
    expect(getPivotMeasureValue(cell, "amount")).toBe(1);
    expect(getPivotMeasureValue(cell, "quantity")).toBe(2);
    expect(getPivotMeasureValue(cell, "count")).toBe(3);
    expect(getPivotMeasureValue(undefined, "amount")).toBe(0);
  });
});

describe("pivotToCsvRows", () => {
  it("matches the rendered tree: header, indentation, and totals row", () => {
    const groups = [
      group("a", "x", "c1", 100, 0, 1),
      group("a", "y", "c1", 300, 0, 1),
      group("a", "x", "c2", 50, 0, 1),
      group(null, null, "c1", 5, 0, 1)
    ];

    const built = buildPivotTree({
      groups,
      valueNames: VALUE_NAMES,
      columnKeys: ["c1", "c2"],
      rowCount: 2,
      measure: "amount"
    });

    const csv = pivotToCsvRows({
      flatTree: built.flatTree,
      columnKeys: built.columnKeys,
      columnTotals: built.columnTotals,
      grandTotal: built.grandTotal,
      measure: "amount",
      columnLabels: { c1: "Jan 2026", c2: "Feb 2026" }
    });

    // header + 5 tree nodes (Alpha, 2 children, Unassigned parent + child) + totals
    expect(csv).toEqual([
      ["", "Jan 2026", "Feb 2026", "Total"],
      ["Alpha", "400", "50", "450"],
      ["  Yankee", "300", "0", "300"],
      ["  X-Ray", "100", "50", "150"],
      ["Unassigned", "5", "0", "5"],
      ["  Unassigned", "5", "0", "5"],
      ["Total", "405", "50", "455"]
    ]);
  });

  it("falls back to the raw column key when a label is missing", () => {
    const built = buildPivotTree({
      groups: [group("a", null, "c1", 10, 0, 1)],
      valueNames: VALUE_NAMES,
      columnKeys: ["c1"],
      rowCount: 1,
      measure: "amount"
    });

    const csv = pivotToCsvRows({
      flatTree: built.flatTree,
      columnKeys: built.columnKeys,
      columnTotals: built.columnTotals,
      grandTotal: built.grandTotal,
      measure: "amount",
      columnLabels: {}
    });

    expect(csv[0]).toEqual(["", "c1", "Total"]);
    expect(csv[csv.length - 1]).toEqual(["Total", "10", "10"]);
  });
});
