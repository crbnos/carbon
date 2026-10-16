// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Supplier parts (`supplierPart`). Mirrors the New Supplier Part drawer on an
// item's Purchasing tab and on a supplier's Parts tab (`supplierPartValidator`,
// `upsertSupplierPart`). An item has one supplier part per supplier
// (`buyMethod_part_supplier_unique`), so a row for a pair that already has
// one updates it, and an item bought from several suppliers takes one row per
// supplier.
//
// A blank cell takes the drawer's default: Minimum Order Quantity, Order
// Multiple and Conversion Factor 1, and the supplier's own currency (NULL,
// the company's base currency, when the supplier has none). A blank Supplier
// Unit of Measure is NULL, which purchasing reads as the item's own unit, and
// a blank Unit Price is NULL. A blank Currency Code never changes an existing
// supplier part's currency: its prices and price breaks are in it.
//
// An update writes the fields `writtenFields` names for its row: the columns
// the wizard maps, a blank cell as its default; with `keepSavedValues` (MCP),
// only the cells the row holds. Updates are set-based (`updateRowsByKey`).

import type { KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { round } from "@carbon/utils";
import type { Kysely } from "kysely";
import { inChunks } from "./chunks";
import {
  cell,
  type ImportRecord,
  type ImportSummary,
  type ItemCandidate,
  loadItemIndex,
  numberCell,
  resolveItem
} from "./existing-item";
import { type NumberRule, numberCellsError } from "./item-extras";
import { type ColumnType, updateRowsByKey } from "./set-based-update";
import { inTransaction } from "./transaction";

const logger = getLogger("server-functions", "import-csv");

// Every item type whose page has a Purchasing tab with supplier parts.
export const SUPPLIER_PART_ITEM_TYPES = [
  "Part",
  "Material",
  "Tool",
  "Consumable",
  "Service"
] as const;

// Bounded as `supplierPartValidator` bounds them; the whole-number ones are
// INTEGER columns.
const SUPPLIER_PART_NUMBERS: Record<string, NumberRule> = {
  minimumOrderQuantity: {
    label: "Minimum Order Quantity",
    integer: true,
    min: 0
  },
  orderMultiple: { label: "Order Multiple", integer: true, min: 1 },
  conversionFactor: { label: "Conversion Factor", integer: false, min: 0 },
  unitPrice: { label: "Unit Price", integer: false, min: 0 }
};

// The supplierPart column each import field writes.
const COLUMN_OF_FIELD = {
  supplierPartId: "supplierPartId",
  supplierUnitOfMeasureCode: "supplierUnitOfMeasureCode",
  minimumOrderQuantity: "minimumOrderQuantity",
  orderMultiple: "orderMultiple",
  conversionFactor: "conversionFactor",
  unitPrice: "supplierUnitPrice",
  currencyCode: "currencyCode"
} as const;

export type SupplierPartValues = {
  supplierPartId: string | null;
  supplierUnitOfMeasureCode: string | null;
  minimumOrderQuantity: number;
  orderMultiple: number;
  conversionFactor: number;
  supplierUnitPrice: number | null;
  /** null when the cell is blank. */
  currencyCode: string | null;
};

export type SupplierPartRowDecision =
  | {
      action: "write";
      itemId: string;
      supplierId: string;
      values: SupplierPartValues;
    }
  | { action: "error"; reason: string };

/** The key of a supplier part: one per item and supplier. */
export const supplierPartKey = (itemId: string, supplierId: string) =>
  `${itemId}::${supplierId}`;

/** One row of the file, checked against the drawer's rules. */
export function classifySupplierPartRow(params: {
  record: ImportRecord;
  itemIndex: Map<string, ItemCandidate[]>;
  // (item, supplier) pairs written by an earlier row of the file.
  seenKeys: Set<string>;
  // Every ISO currency code the file names that exists.
  currencyCodes: ReadonlySet<string>;
}): SupplierPartRowDecision {
  const { record, itemIndex, seenKeys, currencyCodes } = params;
  const error = (reason: string): SupplierPartRowDecision => ({
    action: "error",
    reason
  });

  const item = resolveItem(itemIndex, record, SUPPLIER_PART_ITEM_TYPES);
  if ("error" in item) return error(item.error);

  const supplierId = cell(record.supplierId);
  if (!supplierId) return error("Missing required Supplier");

  if (seenKeys.has(supplierPartKey(item.itemId, supplierId))) {
    return error(
      `Duplicate supplier part for ${item.readableId} rev ${item.revision} and this supplier in file`
    );
  }

  const numbersError = numberCellsError(record, SUPPLIER_PART_NUMBERS);
  if (numbersError) return error(numbersError);

  const currencyCode = cell(record.currencyCode).toUpperCase();
  if (currencyCode && !currencyCodes.has(currencyCode)) {
    return error(`Currency Code "${currencyCode}" not found`);
  }

  // Rounded to the stored scale, as the drawer's number inputs commit them.
  const price = numberCell(record.unitPrice);
  const conversionFactor = numberCell(record.conversionFactor);
  return {
    action: "write",
    itemId: item.itemId,
    supplierId,
    values: {
      supplierPartId: cell(record.supplierPartId) || null,
      supplierUnitOfMeasureCode: cell(record.supplierUnitOfMeasureCode) || null,
      minimumOrderQuantity: numberCell(record.minimumOrderQuantity) ?? 1,
      orderMultiple: numberCell(record.orderMultiple) ?? 1,
      conversionFactor:
        conversionFactor === undefined ? 1 : round(conversionFactor),
      supplierUnitPrice: price === undefined ? null : round(price),
      currencyCode: currencyCode || null
    }
  };
}

/** The currency each supplier is set up in; NULL is the company's base. */
export async function loadSupplierCurrencies(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  supplierIds: string[]
): Promise<Map<string, string | null>> {
  if (supplierIds.length === 0) return new Map();
  const suppliers = await db
    .selectFrom("supplier")
    .select(["id", "currencyCode"])
    .where("companyId", "=", companyId)
    .where("id", "in", supplierIds)
    .execute();
  return new Map(suppliers.map((s) => [s.id, s.currencyCode]));
}

// The supplierPart columns an update can write, typed for the set-based
// update.
const SUPPLIER_PART_COLUMNS: ColumnType[] = [
  { name: "supplierPartId", type: "text" },
  { name: "supplierUnitOfMeasureCode", type: "text" },
  { name: "minimumOrderQuantity", type: "integer" },
  { name: "orderMultiple", type: "integer" },
  { name: "conversionFactor", type: "numeric" },
  { name: "supplierUnitPrice", type: "numeric" },
  { name: "currencyCode", type: "text" }
];

/**
 * The columns an update of an existing supplier part writes: the fields
 * `written` names, except a blank Currency Code, which keeps the saved
 * currency.
 */
export function supplierPartUpdate(
  values: SupplierPartValues,
  written: ReadonlySet<string>
): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(COLUMN_OF_FIELD) as Array<
    [string, keyof SupplierPartValues]
  >) {
    if (!written.has(field)) continue;
    const value = values[column];
    if (column === "currencyCode" && value === null) continue;
    set[column] = value;
  }
  return set;
}

/**
 * Adds or updates the supplier part of each row's item and supplier, in one
 * transaction.
 */
export async function importSupplierParts(
  db: Kysely<KyselyDatabase>,
  args: {
    rows: Array<[number, ImportRecord]>;
    companyId: string;
    userId: string;
    summary: ImportSummary;
    /** The fields an update writes for a row. */
    writtenFields: (row: number) => ReadonlySet<string>;
  }
): Promise<void> {
  const { rows, companyId, userId, summary, writtenFields } = args;

  const records = rows.map(([, record]) => record);
  const fileCurrencies = [
    ...new Set(
      records.map((r) => cell(r.currencyCode).toUpperCase()).filter(Boolean)
    )
  ];
  const [itemIndex, knownCurrencies] = await Promise.all([
    loadItemIndex(db, companyId, records),
    fileCurrencies.length > 0
      ? db
          .selectFrom("currencyCode")
          .select("code")
          .where("code", "in", fileCurrencies)
          .execute()
      : Promise.resolve([])
  ]);
  const currencyCodes = new Set(knownCurrencies.map((c) => c.code));

  const seenKeys = new Set<string>();
  const writes: Array<{
    row: number;
    itemId: string;
    supplierId: string;
    values: SupplierPartValues;
  }> = [];
  for (const [row, record] of rows) {
    const decision = classifySupplierPartRow({
      record,
      itemIndex,
      seenKeys,
      currencyCodes
    });
    if (decision.action === "error") {
      summary.errors.push({ row, reason: decision.reason });
      continue;
    }
    seenKeys.add(supplierPartKey(decision.itemId, decision.supplierId));
    writes.push({ row, ...decision });
  }

  logger.info({
    function: "import-supplier-parts",
    totalRecords: rows.length,
    writes: writes.length
  });

  if (writes.length === 0) return;

  const existing = await db
    .selectFrom("supplierPart")
    .select(["id", "itemId", "supplierId"])
    .where("companyId", "=", companyId)
    .where("itemId", "in", [...new Set(writes.map((w) => w.itemId))])
    .where("supplierId", "in", [...new Set(writes.map((w) => w.supplierId))])
    .execute();
  const existingByPair = new Map(
    existing.map((e) => [supplierPartKey(e.itemId, e.supplierId), e.id])
  );

  const inserts = writes.filter(
    (w) => !existingByPair.has(supplierPartKey(w.itemId, w.supplierId))
  );
  const updates = writes.flatMap((w) => {
    const id = existingByPair.get(supplierPartKey(w.itemId, w.supplierId));
    return id
      ? [
          {
            key: { id },
            set: supplierPartUpdate(w.values, writtenFields(w.row))
          }
        ]
      : [];
  });

  const supplierCurrencies = await loadSupplierCurrencies(db, companyId, [
    ...new Set(
      inserts.filter((w) => !w.values.currencyCode).map((w) => w.supplierId)
    )
  ]);

  await inTransaction(db, async (trx) => {
    await inChunks(inserts, (chunk) =>
      trx
        .insertInto("supplierPart")
        .values(
          chunk.map((w) => ({
            ...w.values,
            itemId: w.itemId,
            supplierId: w.supplierId,
            currencyCode:
              w.values.currencyCode ??
              supplierCurrencies.get(w.supplierId) ??
              null,
            companyId,
            createdBy: userId
          }))
        )
        .execute()
    );
    await updateRowsByKey(trx, {
      table: "supplierPart",
      companyId,
      userId,
      keys: [{ name: "id", type: "text" }],
      columns: SUPPLIER_PART_COLUMNS,
      rows: updates
    });
  });

  summary.inserted += inserts.length;
  summary.updated += updates.length;
  for (const w of writes) {
    if (existingByPair.has(supplierPartKey(w.itemId, w.supplierId))) {
      summary.existingRows?.push(w.row);
    }
  }
}
