// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Item planning (`itemPlanning`). Mirrors the Planning card on an item's
// Planning tab: `itemPlanningValidator` and `upsertItemPlanning`, which
// UPDATEs the item's row for one location. Every item has one row per
// location, created with the item, so this import is update only: a missing
// row is a row error.
//
// The validator lives in the ERP app, which this package cannot import, so
// `planningRuleError` restates its refinements and `PLANNING_COLUMNS` its
// per-field rules. They are checked against the row's values merged over the
// stored ones, because the form always submits the stored values of the
// fields it shows.
//
// A blank cell leaves that column as it is. The route re-plans the item with
// MRP after saving; this import does not, and the next scheduled MRP run picks
// the new settings up. The responsible employee is not imported.

import { Constants, type Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { round } from "@carbon/utils";
import type { Kysely } from "kysely";
import {
  cell,
  type ImportRecord,
  type ImportSummary,
  type ItemCandidate,
  loadItemIndex,
  MAX_INTEGER,
  numberCell,
  resolveItem
} from "./existing-item";
import { type ColumnType, updateRowsByKey } from "./set-based-update";
import { inTransaction } from "./transaction";

const logger = getLogger("server-functions", "import-csv");

// Every item type whose page has a Planning tab.
export const PLANNING_ITEM_TYPES = [
  "Part",
  "Material",
  "Tool",
  "Consumable"
] as const;

type ReorderingPolicy = Database["public"]["Enums"]["itemReorderingPolicy"];
export const REORDERING_POLICIES: readonly ReorderingPolicy[] =
  Constants.public.Enums.itemReorderingPolicy;

// The numeric fields of the planning form, with the validator's minimum. The
// integer ones are INTEGER columns, which refuse a fraction.
export const PLANNING_COLUMNS = {
  reorderPoint: { label: "Reorder Point", min: 0, integer: true },
  reorderQuantity: { label: "Reorder Quantity", min: 0, integer: true },
  demandAccumulationPeriod: {
    label: "Accumulation Period (Weeks)",
    min: 1,
    integer: true
  },
  demandAccumulationSafetyStock: {
    label: "Safety Stock",
    min: 0,
    integer: false
  },
  minimumOrderQuantity: {
    label: "Minimum Order Quantity",
    min: 0,
    integer: true
  },
  maximumOrderQuantity: {
    label: "Maximum Order Quantity",
    min: 0,
    integer: true
  },
  orderMultiple: { label: "Order Multiple", min: 1, integer: true },
  maximumInventoryQuantity: {
    label: "Maximum Inventory Quantity",
    min: 0,
    integer: false
  },
  planningHorizonDays: {
    label: "Planning Horizon (Days)",
    min: 0,
    integer: true
  }
} as const;

type PlanningColumn = keyof typeof PLANNING_COLUMNS;

// Every column a row can set, typed for the set-based update.
const PLANNING_UPDATE_COLUMNS: ColumnType[] = [
  { name: "reorderingPolicy", type: '"itemReorderingPolicy"' },
  ...(
    Object.entries(PLANNING_COLUMNS) as Array<
      [PlanningColumn, (typeof PLANNING_COLUMNS)[PlanningColumn]]
    >
  ).map(([name, rule]) => ({
    name,
    type: rule.integer ? ("integer" as const) : ("numeric" as const)
  }))
];

export type PlanningUpdate = Partial<Record<PlanningColumn, number>> & {
  reorderingPolicy?: ReorderingPolicy;
};

// The stored values the validator's refinements read.
export type StoredPlanning = {
  reorderingPolicy: ReorderingPolicy;
  reorderPoint: number;
  reorderQuantity: number;
  maximumInventoryQuantity: number;
};

/**
 * `itemPlanningValidator`'s two refinements, word for word, including their
 * truthiness: a Maximum Quantity policy with a reorder point of 0 is refused,
 * as the form refuses it.
 */
export function planningRuleError(values: StoredPlanning): string | null {
  if (values.reorderingPolicy === "Maximum Quantity") {
    const ok =
      values.maximumInventoryQuantity &&
      values.reorderPoint &&
      values.maximumInventoryQuantity > values.reorderPoint;
    if (!ok) {
      return "Maximum inventory quantity must be greater than reorder point";
    }
  }
  if (values.reorderingPolicy === "Fixed Reorder Quantity") {
    const ok = values.reorderQuantity && values.reorderQuantity > 0;
    if (!ok) return "Reorder quantity must be greater than 0";
  }
  return null;
}

/** The columns a row sets, or the first reason it cannot. */
export function readPlanningUpdate(
  record: ImportRecord
): { update: PlanningUpdate } | { error: string } {
  const update: PlanningUpdate = {};

  const policy = cell(record.reorderingPolicy);
  if (policy) {
    const match = REORDERING_POLICIES.find((p) => p === policy);
    if (!match) {
      return {
        error: `Reordering Policy "${policy}" must be one of: ${REORDERING_POLICIES.join(", ")}`
      };
    }
    update.reorderingPolicy = match;
  }

  for (const [column, rule] of Object.entries(PLANNING_COLUMNS) as Array<
    [PlanningColumn, (typeof PLANNING_COLUMNS)[PlanningColumn]]
  >) {
    const raw = numberCell(record[column]);
    if (raw === undefined) continue;
    if (Number.isNaN(raw)) return { error: `${rule.label} must be a number` };
    if (rule.integer && !Number.isInteger(raw)) {
      return { error: `${rule.label} must be a whole number` };
    }
    if (rule.integer && raw > MAX_INTEGER) {
      return { error: `${rule.label} must be ${MAX_INTEGER} or less` };
    }
    const value = rule.integer ? raw : round(raw);
    if (value < rule.min) {
      return { error: `${rule.label} must be ${rule.min} or more` };
    }
    update[column] = value;
  }

  return { update };
}

/** The key of a planning row: one per item and location. */
export const planningKey = (itemId: string, locationId: string) =>
  `${itemId}::${locationId}`;

export type PlanningRowDecision =
  | {
      action: "update";
      itemId: string;
      locationId: string;
      update: PlanningUpdate;
    }
  | { action: "skip"; reason: string; category: "error" | "skipped" };

/**
 * One row of the file: the item and location it names and the columns it sets,
 * checked against the Planning tab's rules.
 */
export function classifyPlanningRow(params: {
  record: ImportRecord;
  itemIndex: Map<string, ItemCandidate[]>;
  // Stored planning rows by `planningKey`.
  stored: Map<string, StoredPlanning>;
  // (item, location) pairs already updated by an earlier row of the file.
  seenKeys: Set<string>;
}): PlanningRowDecision {
  const { record, itemIndex, stored, seenKeys } = params;
  const error = (reason: string): PlanningRowDecision => ({
    action: "skip",
    reason,
    category: "error"
  });

  const item = resolveItem(itemIndex, record, PLANNING_ITEM_TYPES);
  if ("error" in item) return error(item.error);

  const locationId = cell(record.locationId);
  if (!locationId) return error("Missing required Location");

  const key = planningKey(item.itemId, locationId);
  const current = stored.get(key);
  if (!current) {
    return error(
      `Item ${item.readableId} rev ${item.revision} has no planning record at this location`
    );
  }
  if (seenKeys.has(key)) {
    return error(
      `Duplicate planning row for ${item.readableId} rev ${item.revision} at this location in file`
    );
  }

  const read = readPlanningUpdate(record);
  if ("error" in read) return error(read.error);
  if (Object.keys(read.update).length === 0) {
    return {
      action: "skip",
      reason: "No planning values to update",
      category: "skipped"
    };
  }

  const ruleError = planningRuleError({ ...current, ...read.update });
  if (ruleError) return error(ruleError);

  return {
    action: "update",
    itemId: item.itemId,
    locationId,
    update: read.update
  };
}

/**
 * Updates the planning of each row's item at its location, in one transaction.
 * MRP is not run.
 */
export async function importItemPlanning(
  db: Kysely<KyselyDatabase>,
  args: {
    rows: Array<[number, ImportRecord]>;
    companyId: string;
    userId: string;
    summary: ImportSummary;
  }
): Promise<void> {
  const { rows, companyId, userId, summary } = args;

  const itemIndex = await loadItemIndex(
    db,
    companyId,
    rows.map(([, record]) => record)
  );
  const itemIds = [...itemIndex.values()].flat().map((c) => c.id);
  const storedRows =
    itemIds.length > 0
      ? await db
          .selectFrom("itemPlanning")
          .select([
            "itemId",
            "locationId",
            "reorderingPolicy",
            "reorderPoint",
            "reorderQuantity",
            "maximumInventoryQuantity"
          ])
          .where("companyId", "=", companyId)
          .where("itemId", "in", itemIds)
          .execute()
      : [];
  const stored = new Map(
    storedRows.map((r) => [
      planningKey(r.itemId, r.locationId),
      {
        reorderingPolicy: r.reorderingPolicy,
        reorderPoint: Number(r.reorderPoint),
        reorderQuantity: Number(r.reorderQuantity),
        maximumInventoryQuantity: Number(r.maximumInventoryQuantity)
      }
    ])
  );

  const seenKeys = new Set<string>();
  const updates: Array<Extract<PlanningRowDecision, { action: "update" }>> = [];
  for (const [row, record] of rows) {
    const decision = classifyPlanningRow({
      record,
      itemIndex,
      stored,
      seenKeys
    });
    if (decision.action === "skip") {
      (decision.category === "error" ? summary.errors : summary.skipped).push({
        row,
        reason: decision.reason
      });
      continue;
    }
    seenKeys.add(planningKey(decision.itemId, decision.locationId));
    updates.push(decision);
  }

  logger.info({
    function: "import-item-planning",
    totalRecords: rows.length,
    updates: updates.length
  });

  if (updates.length === 0) return;

  await inTransaction(db, async (trx) => {
    await updateRowsByKey(trx, {
      table: "itemPlanning",
      companyId,
      userId,
      keys: [
        { name: "itemId", type: "text" },
        { name: "locationId", type: "text" }
      ],
      columns: PLANNING_UPDATE_COLUMNS,
      rows: updates.map(({ itemId, locationId, update }) => ({
        key: { itemId, locationId },
        set: update
      }))
    });
    summary.updated += updates.length;
  });
}
