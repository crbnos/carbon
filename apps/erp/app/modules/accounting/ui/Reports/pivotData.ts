import type { FlatTreeItem } from "~/components/TreeView";
import type { PivotMeasure } from "../../accounting.models";

// Pure pivot assembly for the dimensional analytics reports — no React, no
// data fetching. Spec: .ai/specs/2026-08-09-dimensional-pivot-reporting.md.

export type PivotCellValue = {
  amount: number;
  quantity: number;
  lineCount: number;
};

// Input shape (mirrors getDimensionPivot groups).
export type PivotGroupRow = {
  rowValue1Id: string | null;
  rowValue2Id: string | null;
  columnKey: string | null; // null = Unassigned column (dimension axis)
  amount: number;
  quantity: number;
  lineCount: number;
};

export type PivotRowNode = {
  key: string;
  rowValue1Id: string | null; // null = Unassigned
  rowValue2Id: string | null; // null on level-1 parents and on Unassigned leaves
  label: string; // resolved name or the unassigned label
  isUnassigned: boolean;
  cells: Record<string, PivotCellValue>; // by columnKey; null columnKey stored under UNASSIGNED_COLUMN_KEY
  total: PivotCellValue;
};

export const UNASSIGNED_COLUMN_KEY = "__unassigned__";

// Sentinel sort keys for the non-value columns. Any other sort key is a real
// columnKey. See buildPivotTree's `sort` arg.
export const TOTAL_SORT_KEY = "__total__";
export const LABEL_SORT_KEY = "__label__";

export type PivotSort = { key: string; direction: "asc" | "desc" };

function zeroCell(): PivotCellValue {
  return { amount: 0, quantity: 0, lineCount: 0 };
}

function addTo(
  target: PivotCellValue,
  source: { amount: number; quantity: number; lineCount: number }
): void {
  target.amount += source.amount;
  target.quantity += source.quantity;
  target.lineCount += source.lineCount;
}

/** Read the measure's numeric value off a cell; a missing cell reads as 0. */
export function getPivotMeasureValue(
  cell: PivotCellValue | undefined,
  measure: PivotMeasure
): number {
  if (!cell) return 0;
  if (measure === "quantity") return cell.quantity;
  if (measure === "count") return cell.lineCount;
  return cell.amount;
}

// Internal aggregation node — cells only accumulate visible columns; totals
// accumulate everything (totals stay truthful when columns are truncated).
type RowAgg = {
  cells: Record<string, PivotCellValue>;
  total: PivotCellValue;
  children: Map<string | null, RowAgg>;
};

function newAgg(): RowAgg {
  return { cells: {}, total: zeroCell(), children: new Map() };
}

function getOrCreate(
  map: Map<string | null, RowAgg>,
  key: string | null
): RowAgg {
  let agg = map.get(key);
  if (!agg) {
    agg = newAgg();
    map.set(key, agg);
  }
  return agg;
}

export function buildPivotTree(args: {
  groups: PivotGroupRow[];
  valueNames: Record<string, string>;
  columnKeys: string[]; // ordered, may contain UNASSIGNED_COLUMN_KEY
  rowCount: 0 | 1 | 2; // how many row dimensions are selected
  measure: PivotMeasure; // used for sorting by ABS(total[measure])
  unassignedLabel?: string; // default "Unassigned" — caller passes the localized string
  totalLabel?: string; // default "Total" — label of the single row when rowCount is 0
  maxColumns?: number; // optional; omit for no cap. Keeps the top-N by ABS(measure).
  sort?: PivotSort | null; // row sort; omit/null for the default ABS(measure) desc
}): {
  flatTree: FlatTreeItem<PivotRowNode>[];
  columnKeys: string[];
  columnTotals: Record<string, PivotCellValue>;
  grandTotal: PivotCellValue;
  columnsTruncated: boolean;
} {
  const { groups, valueNames, rowCount, measure } = args;
  const unassignedLabel = args.unassignedLabel ?? "Unassigned";
  const totalLabel = args.totalLabel ?? "Total";
  const maxColumns = args.maxColumns;
  const sort = args.sort ?? null;

  // Column totals + grand total over ALL data (hidden columns included).
  const columnTotals: Record<string, PivotCellValue> = {};
  const grandTotal = zeroCell();
  for (const group of groups) {
    const columnKey = group.columnKey ?? UNASSIGNED_COLUMN_KEY;
    const columnTotal = (columnTotals[columnKey] ??= zeroCell());
    addTo(columnTotal, group);
    addTo(grandTotal, group);
  }
  for (const key of args.columnKeys) {
    columnTotals[key] ??= zeroCell();
  }

  // Column truncation: keep the top maxColumns by ABS(column total of the
  // chosen measure) — but always keep the Unassigned column when present.
  let visibleColumnKeys = args.columnKeys;
  let columnsTruncated = false;
  if (maxColumns !== undefined && args.columnKeys.length > maxColumns) {
    columnsTruncated = true;
    const hasUnassigned = args.columnKeys.includes(UNASSIGNED_COLUMN_KEY);
    const ranked = args.columnKeys
      .filter((key) => key !== UNASSIGNED_COLUMN_KEY)
      .sort(
        (a, b) =>
          Math.abs(getPivotMeasureValue(columnTotals[b], measure)) -
          Math.abs(getPivotMeasureValue(columnTotals[a], measure))
      );
    const keepCount = hasUnassigned ? Math.max(maxColumns - 1, 0) : maxColumns;
    const kept = new Set(ranked.slice(0, keepCount));
    if (hasUnassigned) kept.add(UNASSIGNED_COLUMN_KEY);
    // Preserve the caller's column order.
    visibleColumnKeys = args.columnKeys.filter((key) => kept.has(key));
  }
  const visibleColumnSet = new Set(visibleColumnKeys);

  const accumulate = (agg: RowAgg, columnKey: string, group: PivotGroupRow) => {
    addTo(agg.total, group);
    // Dropped columns are excluded from visible cells; row totals keep them.
    if (visibleColumnSet.has(columnKey)) {
      const cell = (agg.cells[columnKey] ??= zeroCell());
      addTo(cell, group);
    }
  };

  const labelFor = (id: string | null): string =>
    id === null ? unassignedLabel : (valueNames[id] ?? id);

  // Value read for the active column sort (signed, unlike the ABS default).
  const sortValue = (agg: RowAgg): number =>
    sort && sort.key === TOTAL_SORT_KEY
      ? getPivotMeasureValue(agg.total, measure)
      : getPivotMeasureValue(agg.cells[sort?.key ?? ""], measure);

  // Sort: Unassigned always last at its level. With no explicit sort, order by
  // ABS(total[measure]) descending, then label ascending for determinism. With
  // an explicit sort, order by the chosen column/total (signed) or label in the
  // requested direction, tie-broken by label ascending.
  const sortRowEntries = (
    entries: [string | null, RowAgg][]
  ): [string | null, RowAgg][] =>
    entries.sort((a, b) => {
      const [aId, aAgg] = a;
      const [bId, bAgg] = b;
      if ((aId === null) !== (bId === null)) return aId === null ? 1 : -1;

      if (!sort) {
        const diff =
          Math.abs(getPivotMeasureValue(bAgg.total, measure)) -
          Math.abs(getPivotMeasureValue(aAgg.total, measure));
        if (diff !== 0) return diff;
        return labelFor(aId).localeCompare(labelFor(bId));
      }

      const direction = sort.direction === "asc" ? 1 : -1;

      if (sort.key === LABEL_SORT_KEY) {
        return direction * labelFor(aId).localeCompare(labelFor(bId));
      }

      const diff = sortValue(aAgg) - sortValue(bAgg);
      if (diff !== 0) return direction * diff;
      return labelFor(aId).localeCompare(labelFor(bId));
    });

  const flatTree: FlatTreeItem<PivotRowNode>[] = [];

  if (rowCount === 0) {
    // No row grouping: a single level-1 node holding every group.
    const totalAgg = newAgg();
    for (const group of groups) {
      accumulate(totalAgg, group.columnKey ?? UNASSIGNED_COLUMN_KEY, group);
    }
    flatTree.push({
      id: "total",
      parentId: undefined,
      children: [],
      hasChildren: false,
      level: 0,
      data: {
        key: "total",
        rowValue1Id: null,
        rowValue2Id: null,
        label: totalLabel,
        isUnassigned: false,
        cells: totalAgg.cells,
        total: totalAgg.total
      }
    });
  } else {
    const level1 = new Map<string | null, RowAgg>();
    for (const group of groups) {
      const columnKey = group.columnKey ?? UNASSIGNED_COLUMN_KEY;
      const parentAgg = getOrCreate(level1, group.rowValue1Id);
      accumulate(parentAgg, columnKey, group);
      if (rowCount === 2) {
        const childAgg = getOrCreate(parentAgg.children, group.rowValue2Id);
        accumulate(childAgg, columnKey, group);
      }
    }

    const rowKeyPart = (id: string | null): string => id ?? "__unassigned__";

    for (const [rowValue1Id, parentAgg] of sortRowEntries([...level1])) {
      const parentKey = rowKeyPart(rowValue1Id);
      const childEntries =
        rowCount === 2 ? sortRowEntries([...parentAgg.children]) : [];
      const childIds = childEntries.map(
        ([rowValue2Id]) => `${parentKey}|${rowKeyPart(rowValue2Id)}`
      );

      flatTree.push({
        id: parentKey,
        parentId: undefined,
        children: childIds,
        hasChildren: childIds.length > 0,
        level: 0,
        data: {
          key: parentKey,
          rowValue1Id,
          rowValue2Id: null,
          label: labelFor(rowValue1Id),
          isUnassigned: rowValue1Id === null,
          cells: parentAgg.cells,
          total: parentAgg.total
        }
      });

      for (const [rowValue2Id, childAgg] of childEntries) {
        const childKey = `${parentKey}|${rowKeyPart(rowValue2Id)}`;
        flatTree.push({
          id: childKey,
          parentId: parentKey,
          children: [],
          hasChildren: false,
          level: 1,
          data: {
            key: childKey,
            rowValue1Id,
            rowValue2Id,
            label: labelFor(rowValue2Id),
            isUnassigned: rowValue2Id === null,
            cells: childAgg.cells,
            total: childAgg.total
          }
        });
      }
    }
  }

  return {
    flatTree,
    columnKeys: visibleColumnKeys,
    columnTotals,
    grandTotal,
    columnsTruncated
  };
}

/**
 * Per-column percentage of the column total for the chosen measure.
 * A zero column total yields 0 (no division by zero).
 */
export function applyPercentOfTotal(
  cells: Record<string, PivotCellValue>,
  columnTotals: Record<string, PivotCellValue>,
  measure: PivotMeasure
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, cell] of Object.entries(cells)) {
    const total = getPivotMeasureValue(columnTotals[key], measure);
    result[key] =
      total === 0 ? 0 : (getPivotMeasureValue(cell, measure) / total) * 100;
  }
  return result;
}

/**
 * CSV rows exactly as rendered: header row ("", column labels, "Total"), one
 * row per flat-tree node (level-2 labels indented two spaces), and a final
 * totals row.
 */
export function pivotToCsvRows(args: {
  flatTree: FlatTreeItem<PivotRowNode>[];
  columnKeys: string[];
  columnTotals: Record<string, PivotCellValue>;
  grandTotal: PivotCellValue;
  measure: PivotMeasure;
  columnLabels: Record<string, string>;
}): string[][] {
  const {
    flatTree,
    columnKeys,
    columnTotals,
    grandTotal,
    measure,
    columnLabels
  } = args;

  const rows: string[][] = [];
  rows.push([
    "",
    ...columnKeys.map((key) => columnLabels[key] ?? key),
    "Total"
  ]);

  for (const node of flatTree) {
    const indent = "  ".repeat(node.level);
    rows.push([
      `${indent}${node.data.label}`,
      ...columnKeys.map((key) =>
        String(getPivotMeasureValue(node.data.cells[key], measure))
      ),
      String(getPivotMeasureValue(node.data.total, measure))
    ]);
  }

  rows.push([
    "Total",
    ...columnKeys.map((key) =>
      String(getPivotMeasureValue(columnTotals[key], measure))
    ),
    String(getPivotMeasureValue(grandTotal, measure))
  ]);

  return rows;
}
