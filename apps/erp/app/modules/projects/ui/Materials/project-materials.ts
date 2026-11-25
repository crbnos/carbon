// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ProjectMaterialRow } from "../../projects.service";

/** The Supply status of a line that needs a PO or a job and has neither. */
export const NO_SUPPLY = "No supply";

/** The group key of the rows that have no element. */
export const NO_ELEMENT_GROUP = "no-element";

export type MaterialGroupBy = "element" | "item";

type MaterialFilters = {
  search: string | null;
  supplyStatus: string[];
  issueStatus: string[];
};

type MaterialTotals = {
  quantityRequired: number;
  quantityOrdered: number;
  quantityReceived: number;
  quantityIssued: number;
  quantityRemaining: number;
};

export type MaterialGroup = {
  key: string;
  rows: ProjectMaterialRow[];
  /** Null for an element group, and when an item's rows use 2 units of measure. */
  totals: MaterialTotals | null;
};

type SupplyRow = Pick<ProjectMaterialRow, "supplies" | "methodType">;

/** The methods that need a PO line or a job to reach the element. */
const SUPPLIED_METHODS = new Set<ProjectMaterialRow["methodType"]>([
  "Purchase to Order",
  "Make to Order"
]);

/**
 * The stored statuses of a row's PO and job. Only a Purchase to Order or
 * Make to Order line needs one, so only it shows No supply without one: a
 * Pull from Inventory line takes stock, and an Unplanned row has no method.
 */
export function supplyStatuses(row: SupplyRow): string[] {
  if (row.supplies.length > 0) return row.supplies.map((s) => s.status);
  return SUPPLIED_METHODS.has(row.methodType) ? [NO_SUPPLY] : [];
}

export function filterMaterialRows(
  rows: ProjectMaterialRow[],
  { search, supplyStatus, issueStatus }: MaterialFilters
): ProjectMaterialRow[] {
  const needle = search?.trim().toLowerCase() ?? "";
  return rows.filter((row) => {
    if (needle) {
      const haystack = [
        row.itemReadableId,
        row.itemName,
        row.elementReadableId,
        row.elementName
      ];
      if (!haystack.some((value) => value?.toLowerCase().includes(needle))) {
        return false;
      }
    }
    if (
      supplyStatus.length > 0 &&
      !supplyStatuses(row).some((status) => supplyStatus.includes(status))
    ) {
      return false;
    }
    if (issueStatus.length > 0 && !issueStatus.includes(row.issueStatus)) {
      return false;
    }
    return true;
  });
}

function totalsOf(rows: ProjectMaterialRow[]): MaterialTotals | null {
  const units = new Set(rows.map((row) => row.unitOfMeasureCode));
  if (units.size > 1) return null;
  return rows.reduce<MaterialTotals>(
    (sum, row) => ({
      quantityRequired: sum.quantityRequired + row.quantityRequired,
      quantityOrdered: sum.quantityOrdered + row.quantityOrdered,
      quantityReceived: sum.quantityReceived + row.quantityReceived,
      quantityIssued: sum.quantityIssued + row.quantityIssued,
      quantityRemaining: sum.quantityRemaining + (row.quantityRemaining ?? 0)
    }),
    {
      quantityRequired: 0,
      quantityOrdered: 0,
      quantityReceived: 0,
      quantityIssued: 0,
      quantityRemaining: 0
    }
  );
}

/**
 * Groups the rows by element, in the order the RPC returns them (element
 * number, rows with no element last), or by item, in readable id order.
 */
export function groupMaterialRows(
  rows: ProjectMaterialRow[],
  groupBy: MaterialGroupBy
): MaterialGroup[] {
  const byKey = new Map<string, ProjectMaterialRow[]>();
  for (const row of rows) {
    const key =
      groupBy === "item"
        ? row.itemId
        : (row.projectElementId ?? NO_ELEMENT_GROUP);
    const group = byKey.get(key);
    if (group) group.push(row);
    else byKey.set(key, [row]);
  }

  let keys = [...byKey.keys()];
  if (groupBy === "item") {
    keys.sort((a, b) =>
      byKey
        .get(a)![0]!
        .itemReadableId.localeCompare(byKey.get(b)![0]!.itemReadableId)
    );
  } else if (byKey.has(NO_ELEMENT_GROUP)) {
    keys = [
      ...keys.filter((key) => key !== NO_ELEMENT_GROUP),
      NO_ELEMENT_GROUP
    ];
  }

  // Only an item group has totals: an element's rows are different items.
  return keys.map((key) => {
    const groupRows = byKey.get(key)!;
    return {
      key,
      rows: groupRows,
      totals: groupBy === "item" ? totalsOf(groupRows) : null
    };
  });
}
