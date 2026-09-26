// Opening-stock importer — backs the `inventoryQuantity`, `batchQuantity` and
// `serialQuantity` CSV imports. Additive only: every accepted row is ONE
// Positive Adjmt., booked exactly the way the single-record inventory
// adjustment (post-inventory-adjustment) books a positive adjustment:
//
// - Batch / Serial rows first create a new trackedEntity (same columns and
//   "Inventory Adjustment" attributes stamp as a new entity there).
// - The movement writes what the shared posting core (`bookAdjustment`) writes
//   for a positive adjustment: item ledger + cost layer at the item's current
//   cost + (when companySettings.accountingEnabled) a balanced journal against
//   the inventory adjustment variance account. EVERY one of those rows is
//   BUILT by the pure builders `bookAdjustment` itself uses
//   (`shared/plan-adjustment.ts`: `buildItemLedgerRow`, `buildCostLedgerRow`,
//   `buildAdjustmentJournalLines`, `buildJournalLineDimensions`) and
//   inserted in bulk — one statement per table per chunk instead of ~7 round
//   trips per row, which is what keeps a large file inside the edge runtime's
//   wall clock.
// - With accounting on, the whole import shares ONE adjustment journal,
//   created lazily on the first movement that carries value — the
//   post-inventory-count pattern.
//
// Row validation / dedup lives in the pure `classify-stock-row.ts`. No
// externalIntegrationMapping writes: there is no Unique ID column.

import { parseDate } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import type { Kysely } from "kysely";
import type { DB } from "../lib/database.ts";
import { datetime, getCompanyTimeZone } from "../lib/datetime.ts";
import { getFunctionLogger } from "../lib/logging.ts";
import type { Database, Json } from "../lib/types.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getDefaultPostingGroup } from "../shared/get-posting-group.ts";
import {
  buildAdjustmentJournalLines,
  buildCostLedgerRow,
  buildItemLedgerRow,
  buildJournalLineDimensions,
  carriesAdjustmentValue,
  planStockRows,
} from "../shared/plan-adjustment.ts";
import {
  createAdjustmentJournal,
  loadOpenCostLayers,
} from "../shared/post-adjustment.ts";
import {
  buildStockItemMap,
  classifyStockRow,
  STOCK_IMPORT_TRACKING_TYPE,
  type StockImportTable,
  type StockRowResolved,
  storageUnitKey,
  trackedKey,
} from "./classify-stock-row.ts";

const logger = getFunctionLogger("import-csv");

type Rec = Record<string, string>;
type Summary = {
  inserted: number;
  updated: number;
  errors: Array<{ row: number; reason: string }>;
  skipped: Array<{ row: number; reason: string }>;
};

const text = (s: string | undefined): string => (s ?? "").trim();

// Rows per INSERT. Every statement here is a plain multi-row VALUES insert, so
// the ceiling is Postgres' 65535 bind parameters: the widest table written
// (itemLedger, 14 columns) is ~7k parameters at this size, and the deepest
// fan-out (journalLineDimension, 3 tags × 2 lines per row) still lands inside
// one statement per 84 source rows.
const INSERT_CHUNK_SIZE = 500;

const chunked = <T>(rows: T[], size = INSERT_CHUNK_SIZE): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
};

export async function importStockQuantities(
  db: Kysely<DB>,
  client: SupabaseClient<Database>,
  args: {
    table: StockImportTable;
    mappedRecords: Rec[];
    companyId: string;
    userId: string;
    summary: Summary;
  }
): Promise<void> {
  const { table, mappedRecords, companyId, userId, summary } = args;
  const isTracked = table !== "inventoryQuantity";

  // 1. preload lookups ------------------------------------------------------
  const readableIds = [
    ...new Set(mappedRecords.map((r) => text(r.readableId)).filter(Boolean)),
  ];
  const items =
    readableIds.length > 0
      ? await db
          .selectFrom("item")
          .select([
            "id",
            "readableId",
            "revision",
            "readableIdWithRevision",
            "itemTrackingType",
            "replenishmentSystem",
            "type",
          ])
          .where("companyId", "=", companyId)
          .where("readableId", "in", readableIds)
          .orderBy("type")
          .orderBy("id")
          .execute()
      : [];

  const itemIds = items.map((i) => i.id);
  const [itemCosts, shelfLives] =
    itemIds.length > 0
      ? await Promise.all([
          db
            .selectFrom("itemCost")
            .select([
              "itemId",
              "costingMethod",
              "unitCost",
              "standardCost",
              "itemPostingGroupId",
            ])
            .where("companyId", "=", companyId)
            .where("itemId", "in", itemIds)
            .execute(),
          isTracked
            ? db
                .selectFrom("itemShelfLife")
                .select(["itemId", "mode", "days"])
                .where("companyId", "=", companyId)
                .where("itemId", "in", itemIds)
                .execute()
            : Promise.resolve([]),
        ])
      : [[], []];
  const itemCostByItem = new Map(itemCosts.map((c) => [c.itemId, c]));
  const shelfLifeByItem = new Map(shelfLives.map((s) => [s.itemId, s]));

  // readableId + revision → item; ties broken in `buildStockItemMap`. The
  // query order (type, id) makes the fallback pick deterministic.
  const itemMap = buildStockItemMap(
    table,
    items.map((i) => ({
      id: i.id,
      readableId: i.readableId,
      revision: i.revision,
      itemTrackingType: i.itemTrackingType,
      hasItemCost: itemCostByItem.has(i.id),
    }))
  );
  const itemById = new Map(items.map((i) => [i.id, i]));

  const locations = await db
    .selectFrom("location")
    .select(["id"])
    .where("companyId", "=", companyId)
    .execute();
  const locationIds = new Set(locations.map((l) => l.id));

  const referencedLocationIds = [
    ...new Set(
      mappedRecords
        .map((r) => text(r.locationId))
        .filter((l) => l !== "" && locationIds.has(l))
    ),
  ];
  const storageUnits =
    referencedLocationIds.length > 0
      ? await db
          .selectFrom("storageUnit")
          .select(["id", "name", "locationId"])
          .where("companyId", "=", companyId)
          .where("locationId", "in", referencedLocationIds)
          // Only active units, as the single-record adjustment offers
          // (getStorageUnitsListForLocation); an inactive name falls through
          // to the "not found in this location" row error.
          .where("active", "=", true)
          .execute()
      : [];
  const storageUnitMap = new Map<string, string>();
  for (const u of storageUnits) {
    storageUnitMap.set(storageUnitKey(u.locationId, u.name), u.id);
  }

  // Existing batch / serial numbers on the referenced items, any status.
  const existingTrackedKeys = new Set<string>();
  if (isTracked && itemIds.length > 0) {
    const numberField = table === "serialQuantity" ? "serialNumber" : "batchNumber";
    const numbers = [
      ...new Set(mappedRecords.map((r) => text(r[numberField])).filter(Boolean)),
    ];
    if (numbers.length > 0) {
      const existing = await db
        .selectFrom("trackedEntity")
        .select(["itemId", "readableId"])
        .where("companyId", "=", companyId)
        .where("itemId", "in", itemIds)
        .where("readableId", "in", numbers)
        .execute();
      for (const e of existing) {
        if (e.itemId && e.readableId) {
          existingTrackedKeys.add(trackedKey(e.itemId, e.readableId));
        }
      }
    }
  }

  // 2. classify -------------------------------------------------------------
  const seenTrackedKeys = new Set<string>();
  const planned: StockRowResolved[] = [];
  for (const [rowIndex, record] of mappedRecords.entries()) {
    const decision = classifyStockRow({
      table,
      record,
      itemMap,
      locationIds,
      storageUnitMap,
      existingTrackedKeys,
      seenTrackedKeys,
    });
    if (decision.action === "skip") {
      (decision.category === "error" ? summary.errors : summary.skipped).push({
        row: rowIndex,
        reason: decision.reason,
      });
      continue;
    }
    // Claim the dedup slot only once the row is valid, so a rejected row never
    // blocks a later legitimate row with the same number.
    if (decision.row.trackedKey) seenTrackedKeys.add(decision.row.trackedKey);
    planned.push(decision.row);
  }

  logger.info({
    function: "import-stock-quantities",
    table,
    trackingType: STOCK_IMPORT_TRACKING_TYPE[table],
    totalRecords: mappedRecords.length,
    planned: planned.length,
    skipped: summary.skipped.length,
    errors: summary.errors.length,
  });

  if (planned.length === 0) return;

  // 3. accounting context — resolved BEFORE the transaction, as
  // post-inventory-adjustment / post-inventory-count do (REST hops
  // mid-transaction park the size-1 pool in idle-in-transaction).
  const today = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();
  const nowIso = new Date().toISOString();

  const accountingSettings = await client
    .from("companySettings")
    .select("accountingEnabled")
    .eq("id", companyId)
    .single();
  // Fail closed: a failed settings read must not silently post without GL.
  if (accountingSettings.error) {
    throw new Error("Failed to fetch company settings");
  }
  const accountingEnabled = accountingSettings.data?.accountingEnabled ?? false;
  const accountDefaults = accountingEnabled
    ? await getDefaultPostingGroup(client, companyId)
    : null;
  if (accountingEnabled && (accountDefaults?.error || !accountDefaults?.data)) {
    throw new Error("Error getting account defaults");
  }
  const accountingPeriodId = accountingEnabled
    ? await getCurrentAccountingPeriod(client, companyId, db, today)
    : null;

  // Active dimensions for the company group — journal lines get Item /
  // ItemPostingGroup / Location tags.
  const dimensionMap: Record<string, string> = {};
  if (accountingEnabled) {
    const companyRecord = await client
      .from("company")
      .select("companyGroupId")
      .eq("id", companyId)
      .single();
    if (companyRecord.error) throw new Error("Failed to fetch company");
    const dimensions = await client
      .from("dimension")
      .select("id, entityType")
      .eq("companyGroupId", companyRecord.data.companyGroupId)
      .eq("active", true)
      .in("entityType", ["Item", "ItemPostingGroup", "Location"]);
    // Fail closed: journal lines must not silently lose dimension tags.
    if (dimensions.error) throw new Error("Failed to fetch dimensions");
    for (const dim of dimensions.data ?? []) {
      if (dim.entityType) dimensionMap[dim.entityType] = dim.id;
    }
  }

  const accounting =
    accountingEnabled && accountDefaults?.data && accountingPeriodId
      ? {
          accountingPeriodId,
          accountDefaults: {
            rawMaterialsAccount: accountDefaults.data.rawMaterialsAccount,
            finishedGoodsAccount: accountDefaults.data.finishedGoodsAccount,
            inventoryAdjustmentVarianceAccount:
              accountDefaults.data.inventoryAdjustmentVarianceAccount,
          },
          description: "Inventory Adjustment — CSV import",
          userId,
          dimensions: dimensionMap,
        }
      : null;

  // Fixed Duration shelf-life fallback for a new tracked entity with no typed
  // expiry — same rule as post-inventory-adjustment's
  // resolveExpirationForNewEntity. Other modes stay NULL.
  const resolveExpiration = (row: StockRowResolved): string | null => {
    if (row.expirationDate) return row.expirationDate;
    const shelfLife = shelfLifeByItem.get(row.itemId);
    if (shelfLife?.mode === "Fixed Duration" && shelfLife.days) {
      return parseDate(today).add({ days: Number(shelfLife.days) }).toString();
    }
    return null;
  };

  // 4. write — whole file in one transaction --------------------------------
  // Everything is planned in memory first, then written table by table in bulk.
  // The rows are byte-for-byte what `bookAdjustment` writes per movement
  // because every one of them — item ledger, cost layer, journal line,
  // journal line dimension — comes out of the builders in
  // `shared/plan-adjustment.ts` that `bookAdjustment` itself calls, and the
  // cost layers are valued by replaying the per-row read (see
  // `planIncreaseUnitCosts`). Nothing here re-derives a field.
  await db.transaction().execute(async (trx) => {
    // A tracked entity's id is ours to choose, so the ledger rows can name it
    // before anything is inserted.
    const trackedEntityIds = planned.map(() => (isTracked ? nanoid() : null));

    // Value every row up front. `planStockRows` (pure, tested) does the whole
    // per-file plan: which rows carry value at all (bookAdjustment's early
    // return — classifyStockRow already rejects both cases, so it guards a
    // future column rather than a live branch), each row's layer cost from the
    // per-item replay, and which rows post to the GL.
    const planInputs = planned.map((row) => ({
      itemId: row.itemId,
      quantity: row.quantity,
      itemTrackingType: itemById.get(row.itemId)!.itemTrackingType,
    }));
    const openLayersByItem = await loadOpenCostLayers(trx, {
      itemIds: [
        ...new Set(
          planInputs
            .filter((row) =>
              carriesAdjustmentValue(row.quantity, row.itemTrackingType)
            )
            .map((row) => row.itemId)
        ),
      ],
      companyId,
    });
    const rowPlans = planStockRows({
      rows: planInputs,
      itemCosts: itemCostByItem,
      openLayersByItem,
      hasAccounting: accounting !== null,
    });

    // Tracked entities first: the ledger rows reference them.
    if (isTracked) {
      const trackedEntityRows = planned.map((row, rowIndex) => {
        const item = itemById.get(row.itemId)!;
        const expirationDate = resolveExpiration(row);
        // Stamp the trace blob so the popover Source / Override steps show
        // where the entity originated (post-inventory-adjustment shape).
        const adjustmentStamp = {
          userId,
          at: nowIso,
          reason: "Created via CSV import",
        };
        const attributes: Record<string, unknown> = {
          "Inventory Adjustment": adjustmentStamp,
          ...(expirationDate
            ? {
                expiryOverrides: [
                  {
                    previous: null,
                    next: expirationDate,
                    reason: adjustmentStamp.reason,
                    source: "Inventory Adjustment",
                    userId: adjustmentStamp.userId,
                    at: adjustmentStamp.at,
                  },
                ],
              }
            : {}),
        };
        return {
          id: trackedEntityIds[rowIndex]!,
          sourceDocument: "Item",
          sourceDocumentId: row.itemId,
          sourceDocumentReadableId: item.readableIdWithRevision ?? undefined,
          itemId: row.itemId,
          readableId: row.readableId,
          quantity: row.quantity,
          status: "Available" as const,
          expirationDate,
          attributes: attributes as unknown as Json,
          companyId,
          createdBy: userId,
        };
      });
      for (const rows of chunked(trackedEntityRows)) {
        await trx.insertInto("trackedEntity").values(rows).execute();
      }
    }

    // Item ledger. The generated id is each movement's documentId on its cost
    // ledger and journal lines, so the ids have to come back mapped to their
    // source row. `entryNumber` is a SERIAL assigned as the VALUES rows are
    // formed, so sorting each chunk by it recovers the source order without
    // depending on RETURNING's output order.
    const itemLedgerIds: string[] = [];
    for (const rows of chunked(
      planned.map((row, rowIndex) =>
        buildItemLedgerRow({
          postingDate: today,
          entryType: "Positive Adjmt.",
          documentType: null,
          documentId: null,
          correctionOfItemLedgerId: null,
          itemId: row.itemId,
          locationId: row.locationId,
          storageUnitId: row.storageUnitId,
          trackedEntityId: trackedEntityIds[rowIndex],
          quantity: row.quantity,
          comment: row.comment,
          scrapReasonId: null,
          companyId,
          createdBy: userId,
        })
      )
    )) {
      const inserted = await trx
        .insertInto("itemLedger")
        .values(rows)
        .returning(["id", "entryNumber"])
        .execute();
      inserted.sort((a, b) => Number(a.entryNumber) - Number(b.entryNumber));
      for (const row of inserted) itemLedgerIds.push(row.id);
    }
    if (itemLedgerIds.length !== planned.length) {
      throw new Error("Item ledger insert did not return a row per movement");
    }

    // Cost layers.
    const costLedgerRows = planned.flatMap((row, rowIndex) =>
      rowPlans[rowIndex].carriesValue
        ? [
            buildCostLedgerRow({
              entryType: "Positive Adjmt.",
              documentType: null,
              documentId: itemLedgerIds[rowIndex],
              itemId: row.itemId,
              quantity: row.quantity,
              cost: rowPlans[rowIndex].cost,
              postingDate: today,
              companyId,
            }),
          ]
        : []
    );
    for (const rows of chunked(costLedgerRows)) {
      await trx.insertInto("costLedger").values(rows).execute();
    }

    // Journal. A zero-value movement posts no lines, so an all-zero-cost file
    // creates no journal at all — the lazy `getJournalId` behaviour, decided
    // once here instead of per row.
    const postingRowIndexes = planned
      .map((_, rowIndex) => rowIndex)
      .filter((rowIndex) => rowPlans[rowIndex].postsJournal);
    if (accounting && postingRowIndexes.length > 0) {
      const journalId = await createAdjustmentJournal(trx, {
        companyId,
        accountingPeriodId: accounting.accountingPeriodId,
        description: accounting.description,
        postingDate: today,
        userId,
      });

      // `journalLineReference` already identifies a movement's line pair (it
      // is what ties the two sides together on the per-row path), so it is
      // also how the inserted ids find their way back to their movement — no
      // positional assumption about RETURNING.
      const referenceByRowIndex = new Map<number, string>(
        postingRowIndexes.map((rowIndex) => [rowIndex, nanoid()])
      );
      const journalLineRows = postingRowIndexes.flatMap((rowIndex) => {
        const row = planned[rowIndex];
        const item = itemById.get(row.itemId)!;
        return buildAdjustmentJournalLines({
          journalId,
          documentId: itemLedgerIds[rowIndex],
          documentType: null,
          journalLineReference: referenceByRowIndex.get(rowIndex)!,
          isGain: true,
          cost: rowPlans[rowIndex].cost,
          quantity: row.quantity,
          replenishmentSystem: item.replenishmentSystem,
          accountDefaults: accounting.accountDefaults,
          companyId,
        });
      });
      const journalLineIdsByReference = new Map<string, string[]>();
      for (const rows of chunked(journalLineRows)) {
        const inserted = await trx
          .insertInto("journalLine")
          .values(rows)
          .returning(["id", "journalLineReference"])
          .execute();
        for (const line of inserted) {
          const reference = line.journalLineReference;
          const ids = journalLineIdsByReference.get(reference) ?? [];
          ids.push(line.id);
          journalLineIdsByReference.set(reference, ids);
        }
      }

      const dimensionRows = postingRowIndexes.flatMap((rowIndex) => {
        const row = planned[rowIndex];
        const reference = referenceByRowIndex.get(rowIndex)!;
        const journalLineIds = journalLineIdsByReference.get(reference) ?? [];
        if (journalLineIds.length !== 2) {
          throw new Error(
            "Journal line insert did not return a pair per movement"
          );
        }
        return buildJournalLineDimensions({
          journalLineIds,
          dimensions: accounting.dimensions,
          itemId: row.itemId,
          itemPostingGroupId: itemCostByItem.get(row.itemId)!.itemPostingGroupId,
          locationId: row.locationId,
          companyId,
        });
      });
      for (const rows of chunked(dimensionRows)) {
        await trx.insertInto("journalLineDimension").values(rows).execute();
      }
    }

    summary.inserted += planned.length;
  });
}
