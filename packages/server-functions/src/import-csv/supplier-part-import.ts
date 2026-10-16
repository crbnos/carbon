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
// only the cells the row holds.

import type { KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { datetime, round } from "@carbon/utils";
import { type Kysely, sql } from "kysely";
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

type SupplierPartField = keyof typeof COLUMN_OF_FIELD;

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

type SupplierPartUpdate = {
  id: string;
  values: SupplierPartValues;
  written: ReadonlySet<string>;
};

// One UPDATE … FROM (VALUES …) per chunk: each row carries its values and,
// per column, whether to write it.
async function updateSupplierParts(
  trx: Kysely<KyselyDatabase>,
  updates: SupplierPartUpdate[],
  companyId: string,
  userId: string
): Promise<void> {
  const now = datetime.timestamp();
  const writes = (u: SupplierPartUpdate, field: SupplierPartField) =>
    u.written.has(field) &&
    // A blank Currency Code keeps the saved currency.
    (field !== "currencyCode" || u.values.currencyCode !== null);
  await inChunks(updates, async (chunk) => {
    const values = chunk.map(
      (u) => sql`(
        ${u.id}::text,
        ${writes(u, "supplierPartId")}::boolean, ${u.values.supplierPartId}::text,
        ${writes(u, "supplierUnitOfMeasureCode")}::boolean, ${u.values.supplierUnitOfMeasureCode}::text,
        ${writes(u, "minimumOrderQuantity")}::boolean, ${u.values.minimumOrderQuantity}::integer,
        ${writes(u, "orderMultiple")}::boolean, ${u.values.orderMultiple}::integer,
        ${writes(u, "conversionFactor")}::boolean, ${u.values.conversionFactor}::numeric,
        ${writes(u, "unitPrice")}::boolean, ${u.values.supplierUnitPrice}::numeric,
        ${writes(u, "currencyCode")}::boolean, ${u.values.currencyCode}::text
      )`
    );
    await sql`
      UPDATE "supplierPart" AS t SET
        "supplierPartId" = CASE WHEN v."setPartId" THEN v."supplierPartId" ELSE t."supplierPartId" END,
        "supplierUnitOfMeasureCode" = CASE WHEN v."setUnit" THEN v."supplierUnitOfMeasureCode" ELSE t."supplierUnitOfMeasureCode" END,
        "minimumOrderQuantity" = CASE WHEN v."setMoq" THEN v."minimumOrderQuantity" ELSE t."minimumOrderQuantity" END,
        "orderMultiple" = CASE WHEN v."setMultiple" THEN v."orderMultiple" ELSE t."orderMultiple" END,
        "conversionFactor" = CASE WHEN v."setFactor" THEN v."conversionFactor" ELSE t."conversionFactor" END,
        "supplierUnitPrice" = CASE WHEN v."setPrice" THEN v."supplierUnitPrice" ELSE t."supplierUnitPrice" END,
        "currencyCode" = CASE WHEN v."setCurrency" THEN v."currencyCode" ELSE t."currencyCode" END,
        "updatedAt" = ${now},
        "updatedBy" = ${userId}
      FROM (VALUES ${sql.join(values)}) AS v(
        "id",
        "setPartId", "supplierPartId",
        "setUnit", "supplierUnitOfMeasureCode",
        "setMoq", "minimumOrderQuantity",
        "setMultiple", "orderMultiple",
        "setFactor", "conversionFactor",
        "setPrice", "supplierUnitPrice",
        "setCurrency", "currencyCode"
      )
      WHERE t."id" = v."id" AND t."companyId" = ${companyId}
    `.execute(trx);
    return [];
  });
}

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
  const updates: SupplierPartUpdate[] = writes.flatMap((w) => {
    const id = existingByPair.get(supplierPartKey(w.itemId, w.supplierId));
    return id ? [{ id, values: w.values, written: writtenFields(w.row) }] : [];
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
    if (updates.length > 0) {
      await updateSupplierParts(trx, updates, companyId, userId);
    }
  });

  summary.inserted += inserts.length;
  summary.updated += updates.length;
  for (const w of writes) {
    if (existingByPair.has(supplierPartKey(w.itemId, w.supplierId))) {
      summary.existingRows?.push(w.row);
    }
  }
}
