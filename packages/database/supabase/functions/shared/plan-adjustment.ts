// Pure row planning for inventory adjustment postings. No I/O, so it is
// unit-testable with `deno test` and — more importantly — it is the SINGLE
// copy of the arithmetic that `bookAdjustment` (one movement at a time) and
// the bulk opening-stock importer (a whole CSV in a handful of statements)
// both write. Neither may re-derive a cost, an account side or a dimension
// tag on its own.

import { Database } from "../lib/types.ts";
import { credit, debit } from "../lib/utils.ts";
import { resolveInventoryAccount } from "./get-posting-group.ts";
import {
  AdjustmentItemCost,
  computeCurrentUnitCost,
  OpenCostLayer,
} from "./post-adjustment-cost.ts";
import { round } from "./precision.ts";

type ItemLedgerInsert = Database["public"]["Tables"]["itemLedger"]["Insert"];
type CostLedgerInsert = Database["public"]["Tables"]["costLedger"]["Insert"];
type JournalLineInsert = Database["public"]["Tables"]["journalLine"]["Insert"];
type JournalLineDimensionInsert =
  Database["public"]["Tables"]["journalLineDimension"]["Insert"];
type ItemLedgerDocumentType =
  Database["public"]["Enums"]["itemLedgerDocumentType"];
type JournalLineDocumentType =
  Database["public"]["Enums"]["journalLineDocumentType"];

// itemLedgerDocumentType values that also exist on journalLineDocumentType.
// The journal line falls back to 'Inventory Adjustment' for ledger documentType
// values the journal enum doesn't carry (e.g. 'Sales Invoice', 'Direct
// Transfer', 'Posted Assembly') — inserting those would fail the enum cast.
export const JOURNAL_LINE_SAFE_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  "Sales Shipment",
  "Purchase Receipt",
  "Purchase Invoice",
  "Transfer Shipment",
  "Job Consumption",
  "Job Receipt",
  "Batch Split",
  "Maintenance Consumption",
  "Inventory Count",
  "Non-Conformance",
  "Inbound Inspection",
  "Scrap",
]);

export function toJournalLineDocumentType(
  documentType: ItemLedgerDocumentType | null | undefined
): JournalLineDocumentType {
  return (
    documentType && JOURNAL_LINE_SAFE_DOCUMENT_TYPES.has(documentType)
      ? documentType
      : "Inventory Adjustment"
  ) as JournalLineDocumentType;
}

// The item ledger row for a movement — the stock movement itself, written
// before anything that references it. `quantity` is SIGNED (positive for an
// increase, negative for a decrease) and is the only field with arithmetic on
// it. Every caller goes through here so a column added to the movement lands
// on the single-record path and the bulk importer at once.
export function buildItemLedgerRow(args: {
  postingDate: string;
  entryType: Database["public"]["Enums"]["itemLedgerType"];
  documentType?: ItemLedgerDocumentType | null;
  documentId?: string | null;
  correctionOfItemLedgerId?: string | null;
  itemId: string;
  locationId: string | null;
  storageUnitId: string | null;
  trackedEntityId: string | null;
  quantity: number;
  comment?: string | null;
  scrapReasonId?: string | null;
  companyId: string;
  createdBy: string;
}): ItemLedgerInsert {
  return {
    postingDate: args.postingDate,
    entryType: args.entryType,
    documentType: args.documentType ?? null,
    documentId: args.documentId ?? null,
    correctionOfItemLedgerId: args.correctionOfItemLedgerId ?? null,
    itemId: args.itemId,
    locationId: args.locationId,
    storageUnitId: args.storageUnitId,
    trackedEntityId: args.trackedEntityId,
    quantity: round(args.quantity),
    comment: args.comment ?? null,
    scrapReasonId: args.scrapReasonId ?? null,
    companyId: args.companyId,
    createdBy: args.createdBy,
  };
}

// One cost-ledger row for a movement. `quantity` and `cost` are SIGNED —
// negative for a decrease (the relief of carrying value), positive for an
// increase. A decrease leaves nothing to consume later, so its layer opens
// with remainingQuantity 0; an increase opens a layer for its full quantity.
export function buildCostLedgerRow(args: {
  entryType: Database["public"]["Enums"]["itemLedgerType"];
  documentType?: ItemLedgerDocumentType | null;
  documentId: string;
  itemId: string;
  quantity: number;
  cost: number;
  postingDate: string;
  companyId: string;
}): CostLedgerInsert {
  const quantity = round(args.quantity);
  return {
    itemLedgerType: args.entryType,
    costLedgerType: "Direct Cost",
    adjustment: false,
    documentType: args.documentType ?? null,
    documentId: args.documentId,
    itemId: args.itemId,
    quantity,
    cost: round(args.cost),
    remainingQuantity: quantity > 0 ? quantity : 0,
    postingDate: args.postingDate,
    companyId: args.companyId,
  };
}

// The balanced pair for a movement that carries value: the inventory account
// against the offset (variance / scrap) account. `cost` and `quantity` are
// ABSOLUTE; `isGain` picks which side each account takes.
export function buildAdjustmentJournalLines(args: {
  journalId: string;
  documentId: string;
  documentType?: ItemLedgerDocumentType | null;
  journalLineReference: string;
  isGain: boolean;
  cost: number;
  quantity: number;
  replenishmentSystem:
    | Database["public"]["Enums"]["itemReplenishmentSystem"]
    | null;
  accountDefaults: {
    rawMaterialsAccount: string;
    finishedGoodsAccount: string;
    inventoryAdjustmentVarianceAccount: string;
  };
  offsetAccount?: string | null;
  offsetDescription?: string;
  companyId: string;
}): [JournalLineInsert, JournalLineInsert] {
  const inventoryAccount = resolveInventoryAccount(
    args.replenishmentSystem,
    args.accountDefaults
  );
  const documentType = toJournalLineDocumentType(args.documentType);
  const quantity = round(args.quantity);
  const shared = {
    journalId: args.journalId,
    quantity,
    documentType,
    documentId: args.documentId,
    journalLineReference: args.journalLineReference,
    companyId: args.companyId,
  };
  return [
    {
      ...shared,
      accountId: inventoryAccount.account,
      description: inventoryAccount.description,
      amount: round(
        args.isGain ? debit("asset", args.cost) : credit("asset", args.cost)
      ),
    },
    {
      ...shared,
      accountId:
        args.offsetAccount ??
        args.accountDefaults.inventoryAdjustmentVarianceAccount,
      description: args.offsetDescription ?? "Inventory Adjustment",
      amount: round(
        args.isGain ? credit("expense", args.cost) : debit("expense", args.cost)
      ),
    },
  ];
}

// Dimension tags (post-shipment precedent): every line of the entry gets the
// movement's Item / ItemPostingGroup / Location, for whichever dimensions are
// active on the company group, plus any caller-supplied extras.
export function buildJournalLineDimensions(args: {
  journalLineIds: string[];
  dimensions: Record<string, string>;
  itemId: string;
  itemPostingGroupId?: string | null;
  locationId: string | null;
  extraDimensions?: Array<{ entityType: string; valueId: string }>;
  companyId: string;
}): JournalLineDimensionInsert[] {
  const dimensionValues: Array<[string, string | null | undefined]> = [
    ["Item", args.itemId],
    ["ItemPostingGroup", args.itemPostingGroupId],
    ["Location", args.locationId],
    ...(args.extraDimensions ?? []).map(
      (d) => [d.entityType, d.valueId] as [string, string]
    ),
  ];
  return args.journalLineIds.flatMap((journalLineId) =>
    dimensionValues
      .filter(([entityType, valueId]) => args.dimensions[entityType] && valueId)
      .map(([entityType, valueId]) => ({
        journalLineId,
        dimensionId: args.dimensions[entityType],
        valueId: valueId as string,
        companyId: args.companyId,
      }))
  );
}

export interface PlannedIncrease {
  /** The layer's unit cost, as `computeCurrentUnitCost` would return it. */
  unitCost: number;
  /** quantity × unitCost, unrounded — `buildCostLedgerRow` rounds it. */
  cost: number;
}

// Successive increases for ONE item, in the order they will be written.
//
// Booking them one at a time re-reads the item's open cost layers before every
// row, so row n+1 sees the layer row n just wrote. This replays that read in
// memory from a SINGLE starting snapshot, which is what lets the caller write
// the whole file in a few statements instead of a query per row.
//
// Why the replay and not one hoisted unit cost per item:
//
// - Standard and Average ignore the layers entirely (`computeCurrentUnitCost`
//   returns standardCost / itemCost.unitCost), so every row of an item gets
//   the same unit cost. The replay reproduces that for free.
// - FIFO and LIFO take the remaining-quantity-weighted average of the open
//   layers. Adding a layer of quantity q at exactly that average u contributes
//   value q·u against quantity q, so the average is unchanged: (V + q·u) /
//   (R + q) = (u·R + q·u) / (R + q) = u. In EXACT arithmetic the cost is
//   therefore hoistable. It is not hoistable as written, because the layer is
//   stored as round(q·u, 5) (`buildCostLedgerRow`): row n+1 reads the rounded
//   cost back and divides by q, so the average drifts by up to half a unit of
//   the 5th decimal per row — and the drift is scaled up by the next row's
//   quantity. A 1-unit row at 1/3 stores 0.33333; a following 1000-unit row
//   then books 333.33, not 333.33333. Replaying the rounded layer keeps the
//   batch path byte-identical to the per-row path instead of "close".
// - The fallback branch (no open layers → itemCost.unitCost) is covered by the
//   same replay: the first row opens a layer at that fallback cost, and every
//   later row averages over it.
//
// Rows whose quantity rounds to 0 open no layer the next row can see (the
// open-layer query filters remainingQuantity > 0), so they are skipped here
// exactly as the query would skip them.
export function planIncreaseUnitCosts(
  itemCost: AdjustmentItemCost,
  openLayers: OpenCostLayer[],
  quantities: number[]
): PlannedIncrease[] {
  const layers = [...openLayers];
  return quantities.map((quantity) => {
    const unitCost = computeCurrentUnitCost(itemCost, layers);
    // Build the layer through the same builder the caller will insert with,
    // and read the stored values back off it — the replay must see what the
    // database would have handed the next row, not a second derivation of it.
    // Only quantity / remainingQuantity / cost are read, so the identity
    // fields are placeholders.
    const row = buildCostLedgerRow({
      entryType: "Positive Adjmt.",
      documentType: null,
      documentId: "",
      itemId: "",
      quantity,
      cost: quantity * unitCost,
      postingDate: "",
      companyId: "",
    });
    if ((row.remainingQuantity ?? 0) > 0) {
      // New layers carry no applied adjustment children.
      layers.push({
        quantity: row.quantity as number,
        remainingQuantity: row.remainingQuantity as number,
        cost: row.cost as number,
        appliedChildCost: 0,
      });
    }
    return { unitCost, cost: quantity * unitCost };
  });
}

// Whether a movement carries value at all — `bookAdjustment`'s early return:
// a Non-Inventory item or a zero-quantity movement books the ledger row alone,
// with no cost layer and no journal.
export function carriesAdjustmentValue(
  quantity: number,
  itemTrackingType: string | null
): boolean {
  return quantity !== 0 && itemTrackingType !== "Non-Inventory";
}

export interface StockRowPlanInput {
  itemId: string;
  quantity: number;
  itemTrackingType: string | null;
}

export interface StockRowPlan {
  /** false ⇒ ledger row only: no cost layer, no journal line. */
  carriesValue: boolean;
  /** The layer's cost, unrounded; 0 when the row carries no value. */
  cost: number;
  /** Whether this row contributes a journal line pair. */
  postsJournal: boolean;
}

// The whole-file plan the bulk opening-stock importer writes from, one entry
// per source row in source order.
//
// This is the batching itself, kept pure and away from the transaction: group
// the valued rows by item, replay each item's cost layers once
// (`planIncreaseUnitCosts`), scatter the per-item costs back onto the rows
// they came from, and decide which rows post to the GL. `bookAdjustment` makes
// the same three decisions one movement at a time; getting the scatter or the
// journal filter wrong here is what would put a wrong cost on every row, so it
// is a function with a test rather than a loop inside a transaction.
export function planStockRows(args: {
  rows: StockRowPlanInput[];
  itemCosts: ReadonlyMap<string, AdjustmentItemCost>;
  openLayersByItem: ReadonlyMap<string, OpenCostLayer[]>;
  /** false ⇒ accounting disabled: no journal at all. */
  hasAccounting: boolean;
}): StockRowPlan[] {
  const plans: StockRowPlan[] = args.rows.map((row) => ({
    carriesValue: carriesAdjustmentValue(row.quantity, row.itemTrackingType),
    cost: 0,
    postsJournal: false,
  }));

  const rowIndexesByItem = new Map<string, number[]>();
  args.rows.forEach((row, rowIndex) => {
    if (!plans[rowIndex].carriesValue) return;
    const indexes = rowIndexesByItem.get(row.itemId) ?? [];
    indexes.push(rowIndex);
    rowIndexesByItem.set(row.itemId, indexes);
  });

  for (const [itemId, rowIndexes] of rowIndexesByItem) {
    const itemCost = args.itemCosts.get(itemId);
    if (!itemCost) {
      throw new Error(`No item cost for item ${itemId}`);
    }
    const increases = planIncreaseUnitCosts(
      itemCost,
      args.openLayersByItem.get(itemId) ?? [],
      rowIndexes.map((rowIndex) => args.rows[rowIndex].quantity)
    );
    rowIndexes.forEach((rowIndex, n) => {
      const cost = increases[n].cost;
      plans[rowIndex].cost = cost;
      // A zero-value movement posts no journal — `bookAdjustment`'s
      // `!accounting || cost === 0` guard, per row.
      plans[rowIndex].postsJournal = args.hasAccounting && cost !== 0;
    });
  }

  return plans;
}
