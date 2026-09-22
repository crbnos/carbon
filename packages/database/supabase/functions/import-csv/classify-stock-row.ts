// Pure per-row decision for the opening-stock CSV imports (inventoryQuantity,
// batchQuantity, serialQuantity). No DB, no I/O — so it is unit-testable with
// `deno test`. The driver (`stock-quantity-import.ts`) preloads the lookups,
// owns the running `seenTrackedKeys` set and applies the returned action.
//
// Every accepted row becomes ONE Positive Adjmt. — these imports only ever add
// stock, never reduce or set it.

import { round } from "../shared/precision.ts";

export type StockImportTable =
  | "inventoryQuantity"
  | "batchQuantity"
  | "serialQuantity";

// The item tracking type each import accepts.
export const STOCK_IMPORT_TRACKING_TYPE: Record<StockImportTable, string> = {
  inventoryQuantity: "Inventory",
  batchQuantity: "Batch",
  serialQuantity: "Serial",
};

// The import a user should reach for, per tracking type, for the mismatch
// error message.
const IMPORT_LABEL_BY_TRACKING_TYPE: Record<string, string> = {
  Inventory: "Inventory Quantities",
  Batch: "Batch Quantities",
  Serial: "Serial Quantities",
};

export type StockItemInfo = {
  // More than one item shares this part number + revision AND this import's
  // tracking type, so the row cannot name one item. Reported per row rather
  // than resolved arbitrarily: posting opening stock to the wrong item is
  // silent and expensive to unwind.
  ambiguous?: boolean;
  id: string;
  itemTrackingType: string | null;
  hasItemCost: boolean;
};

export type StockRowResolved = {
  itemId: string;
  locationId: string;
  storageUnitId: string | null;
  quantity: number;
  // Batch / serial number; null for Inventory rows.
  readableId: string | null;
  expirationDate: string | null;
  comment: string | null;
  // In-file / existing dedup key for Batch / Serial rows; null for Inventory.
  trackedKey: string | null;
};

export type StockRowDecision =
  | { action: "post"; row: StockRowResolved }
  | { action: "skip"; reason: string; category: "error" | "skipped" };

const text = (s: string | undefined): string => (s ?? "").trim();

// Same shape as method-import.ts: readableId + revision, blank revision → "0".
export const itemKey = (readableId: string, revision: string) =>
  `${readableId} ${revision || "0"}`;

// readableId + revision → item (method-import key). item_unique also includes
// `type`, so two items (e.g. a Part and a Tool) can share the key. Ties break
// deterministically: the candidate whose tracking type matches this import
// wins; otherwise the first candidate in input order (the driver orders the
// query by type, id).
export function buildStockItemMap(
  table: StockImportTable,
  candidates: Array<{
    id: string;
    readableId: string;
    revision: string | null;
    itemTrackingType: string | null;
    hasItemCost: boolean;
  }>
): Map<string, StockItemInfo> {
  const expected = STOCK_IMPORT_TRACKING_TYPE[table];
  const map = new Map<string, StockItemInfo>();
  for (const c of candidates) {
    const key = itemKey(c.readableId, c.revision ?? "0");
    const current = map.get(key);
    if (!current) {
      map.set(key, {
        id: c.id,
        itemTrackingType: c.itemTrackingType,
        hasItemCost: c.hasItemCost,
      });
      continue;
    }
    const currentMatches = current.itemTrackingType === expected;
    const candidateMatches = c.itemTrackingType === expected;
    if (candidateMatches && currentMatches) {
      // Two items of this import's tracking type share the identity: neither
      // can be chosen, so mark the key and let classifyStockRow reject rows.
      map.set(key, { ...current, ambiguous: true });
      continue;
    }
    if (candidateMatches && !currentMatches) {
      map.set(key, {
        id: c.id,
        itemTrackingType: c.itemTrackingType,
        hasItemCost: c.hasItemCost,
      });
    }
  }
  return map;
}

// Storage unit names are unique per location (storageUnit_name_locationId_key)
// and resolved case-insensitively — the storageUnit import's natural key.
export const storageUnitKey = (locationId: string, name: string) =>
  `${locationId}::${name.trim().toLowerCase()}`;

// A batch / serial number is unique per item, not per company: the same serial
// on two different items is allowed.
export const trackedKey = (itemId: string, readableId: string) =>
  `${itemId}::${readableId}`;

// ISO calendar date (YYYY-MM-DD) that actually exists. Hand-rolled rather than
// JS Date, which silently rolls 2026-02-30 over to March.
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

export function classifyStockRow(params: {
  table: StockImportTable;
  record: Record<string, string>;
  itemMap: Map<string, StockItemInfo>;
  locationIds: Set<string>;
  storageUnitMap: Map<string, string>;
  existingTrackedKeys: Set<string>;
  seenTrackedKeys: Set<string>;
}): StockRowDecision {
  const {
    table,
    record,
    itemMap,
    locationIds,
    storageUnitMap,
    existingTrackedKeys,
    seenTrackedKeys,
  } = params;
  const error = (reason: string): StockRowDecision => ({
    action: "skip",
    reason,
    category: "error",
  });

  const readableId = text(record.readableId);
  const revision = text(record.revision) || "0";
  if (!readableId) return error("Missing required Part Number");

  const item = itemMap.get(itemKey(readableId, revision));
  if (!item) return error(`Item ${readableId} rev ${revision} not found`);

  const expectedTrackingType = STOCK_IMPORT_TRACKING_TYPE[table];
  if (item.ambiguous) {
    return error(
      `More than one item is ${expectedTrackingType} tracked with part number ${readableId} rev ${revision}`
    );
  }
  if (item.itemTrackingType !== expectedTrackingType) {
    const other = IMPORT_LABEL_BY_TRACKING_TYPE[item.itemTrackingType ?? ""];
    return error(
      other
        ? `Item ${readableId} rev ${revision} is ${item.itemTrackingType} tracked; use the ${other} import`
        : `Item ${readableId} rev ${revision} is ${
            item.itemTrackingType ?? "not"
          } tracked and holds no stock`
    );
  }

  const locationId = text(record.locationId);
  if (!locationId) return error("Missing required Location");
  if (!locationIds.has(locationId)) return error("Location not found");

  const storageUnitName = text(record.storageUnitName);
  let storageUnitId: string | null = null;
  if (storageUnitName) {
    storageUnitId =
      storageUnitMap.get(storageUnitKey(locationId, storageUnitName)) ?? null;
    if (!storageUnitId) {
      return error(
        `Storage unit "${storageUnitName}" not found in this location`
      );
    }
  }

  // Serial rows carry no Quantity: each row is exactly one unit.
  let quantity = 1;
  if (table !== "serialQuantity") {
    const raw = text(record.quantity);
    const parsed = raw === "" ? Number.NaN : Number(raw);
    // Round to posting precision BEFORE validating, and carry the rounded
    // value: buildItemLedgerRow rounds the same way, so a quantity finer than
    // the scale (0.000001) would otherwise report an inserted movement that
    // adds nothing, and leave trackedEntity.quantity disagreeing with the
    // ledger.
    quantity = round(parsed);
    if (!Number.isFinite(parsed) || quantity <= 0) {
      return error("Quantity must be a positive number");
    }
  }

  let trackedNumber: string | null = null;
  if (table === "batchQuantity") {
    trackedNumber = text(record.batchNumber);
    if (!trackedNumber) return error("Missing required Batch Number");
  } else if (table === "serialQuantity") {
    trackedNumber = text(record.serialNumber);
    if (!trackedNumber) return error("Missing required Serial Number");
  }

  let expirationDate: string | null = null;
  if (table !== "inventoryQuantity") {
    const raw = text(record.expirationDate);
    if (raw) {
      if (!isIsoDate(raw)) {
        return error(
          `Expiration Date "${raw}" is not a valid date (use YYYY-MM-DD)`
        );
      }
      expirationDate = raw;
    }
  }

  if (!item.hasItemCost) {
    return error(`Item ${readableId} rev ${revision} has no item cost record`);
  }

  let key: string | null = null;
  if (trackedNumber) {
    const label = table === "serialQuantity" ? "Serial number" : "Batch number";
    key = trackedKey(item.id, trackedNumber);
    if (existingTrackedKeys.has(key)) {
      return {
        action: "skip",
        reason: `${label} "${trackedNumber}" already exists for this item`,
        category: "skipped",
      };
    }
    if (seenTrackedKeys.has(key)) {
      return {
        action: "skip",
        reason: `Duplicate ${label.toLowerCase()} "${trackedNumber}" for this item in file`,
        category: "skipped",
      };
    }
  }

  return {
    action: "post",
    row: {
      itemId: item.id,
      locationId,
      storageUnitId,
      quantity,
      readableId: trackedNumber,
      expirationDate,
      comment: text(record.comment) || null,
      trackedKey: key,
    },
  };
}
