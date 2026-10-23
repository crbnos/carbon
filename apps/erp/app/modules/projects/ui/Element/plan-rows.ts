// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export type PlanLineType = "material" | "labor" | "cost";

const TYPE_ORDER: Record<PlanLineType, number> = {
  material: 0,
  labor: 1,
  cost: 2
};

type OrderablePlanRow = {
  type: PlanLineType;
  id: string | null;
  createdAt: string | null;
  /** A row from "Add line" that is not on the server yet. */
  draft: boolean;
};

/**
 * The plan grid's one order: materials, then labor, then other costs. In a
 * type, the saved lines by `createdAt` then `id`, then the drafts in the
 * order they were added. So a draft sits where its line will sit once it is
 * saved (the newest line of its type), and a cell edit never moves a row.
 */
export function orderPlanRows<T extends OrderablePlanRow>(rows: T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const type = TYPE_ORDER[a.row.type] - TYPE_ORDER[b.row.type];
      if (type !== 0) return type;
      if (a.row.draft !== b.row.draft) return a.row.draft ? 1 : -1;
      if (a.row.draft) return a.index - b.index;
      const created = compareText(a.row.createdAt, b.row.createdAt);
      if (created !== 0) return created;
      const id = compareText(a.row.id, b.row.id);
      return id !== 0 ? id : a.index - b.index;
    })
    .map(({ row }) => row);
}

/** Text order with a missing value last. ISO timestamps sort as text. */
function compareText(a: string | null, b: string | null) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}
