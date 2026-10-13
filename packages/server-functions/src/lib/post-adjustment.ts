// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import type { AutomaticJournalStatus } from "@carbon/database/journal-posting-status";
import { getNextSequence } from "@carbon/database/sequence";
import { datetime } from "@carbon/utils";
import type { Transaction } from "kysely";
import { nanoid } from "nanoid";
import { calculateCOGS } from "./calculate-cogs";
import {
  buildAdjustmentJournalLines,
  buildCostLedgerRow,
  buildItemLedgerRow,
  buildJournalLineDimensions,
  carriesAdjustmentValue
} from "./plan-adjustment";
import {
  type AdjustmentItemCost,
  computeCurrentUnitCost,
  type OpenCostLayer
} from "./post-adjustment-cost";

export interface BookAdjustmentArgs {
  ledger: {
    postingDate: string; // yyyy-MM-dd
    itemId: string;
    // SIGNED delta: > 0 for Positive Adjmt., < 0 for Negative Adjmt.
    quantity: number;
    locationId: string | null;
    storageUnitId: string | null;
    trackedEntityId: string | null;
    entryType: "Positive Adjmt." | "Negative Adjmt.";
    // itemLedgerDocumentType — manual adjustments stay NULL (ledger rows keep
    // today's shape; 'Inventory Adjustment' exists only on journalLineDocumentType).
    // Non-Conformance / Inbound Inspection tag NCR-disposition & inspection-reject
    // write-offs (these also flow to the journal line's documentType). The full
    // enum is accepted because stock-movement corrections copy the ORIGINAL
    // movement's documentType so document-scoped movement views keep including
    // the fix.
    documentType?: Database["public"]["Enums"]["itemLedgerDocumentType"] | null;
    documentId?: string | null;
    correctionOfItemLedgerId?: string | null;
    comment?: string | null;
    // Reason for scrap/unscrap movements (documentType 'Scrap'); NULL for
    // every other adjustment. MES production scrap keeps its reason on
    // productionQuantity.scrapReasonId.
    scrapReasonId?: string | null;
    companyId: string;
    createdBy: string;
  };
  item: {
    itemTrackingType: string | null;
    replenishmentSystem:
      | Database["public"]["Enums"]["itemReplenishmentSystem"]
      | null;
    itemPostingGroupId?: string | null;
  };
  itemCost: AdjustmentItemCost;
  // null ⇒ no journal: ledger + cost layers only (asset transfers and rental
  // returns value the movement inside a journal of their own)
  accounting: {
    // Provisional before the company's accounting cutover, Posted after it
    // (journalPostingStatus). A Provisional journal has no accounting period.
    postingStatus: AutomaticJournalStatus;
    accountingPeriodId: string | null;
    accountDefaults: {
      rawMaterialsAccount: string;
      finishedGoodsAccount: string;
      inventoryAdjustmentVarianceAccount: string;
    };
    // Offset (non-inventory) side of the balanced pair. Defaults to
    // inventoryAdjustmentVarianceAccount; NCR-disposition / inspection-reject
    // write-offs pass the company's scrapAccount so cost of quality is separable
    // on the P&L.
    offsetAccount?: string | null;
    offsetDescription?: string;
    // journal.sourceType for a header this call creates (default
    // 'Inventory Adjustment'). Ignored when getJournalId supplies a shared journal.
    sourceType?: Database["public"]["Enums"]["journalEntrySourceType"];
    description: string;
    userId: string;
    // active dimensions for the company group, entityType → dimension id
    // (Item / ItemPostingGroup / Location are consulted) — journal lines get
    // journalLineDimension tags for whichever are configured
    dimensions?: Record<string, string>;
    // Additional journalLineDimension tags beyond Item/ItemPostingGroup/
    // Location (ScrapReason / WorkCenter / Employee for scrap postings).
    // entityType must be a dimensionEntityType value present in `dimensions`;
    // valueId is the referenced entity id (polymorphic, no FK).
    extraDimensions?: Array<{ entityType: string; valueId: string }>;
    // When set, lines append to this shared journal instead of the core
    // creating one journal per movement — inventory counts post ONE journal
    // per count with a line pair per variance. Lazy (called only when a
    // movement writes a pair: one with value, or any outbound one) so a run
    // of zero-cost increases never creates an empty journal.
    getJournalId?: () => Promise<string>;
  } | null;
  // storage-unit-transfer legs move stock between bins without changing its
  // value: ledger row only — no cost layers, no journal
  skipValuation?: boolean;
  // Book an INCREASE's new cost layer at this unit cost instead of
  // computeCurrentUnitCost — Unscrap reverses at the original scrapped cost
  // (Oracle Return-from-Scrap precedent). Ignored for decreases, which always
  // relieve via calculateCOGS.
  fixedUnitCost?: number;
}

export interface BookAdjustmentResult {
  itemLedgerId: string;
  journalId: string | null;
  cost: number;
}

export interface CreateAdjustmentJournalArgs {
  companyId: string;
  // null for a Provisional journal: it has no accounting period
  accountingPeriodId: string | null;
  status: AutomaticJournalStatus;
  description: string;
  postingDate: string;
  userId: string;
  sourceType?: Database["public"]["Enums"]["journalEntrySourceType"];
}

// One journal header for adjustment postings ('Inventory Adjustment' source,
// Provisional before the accounting cutover, Posted after it). Manual adjustments create one per movement; inventory
// counts share ONE journal per count post via accounting.getJournalId.
export async function createAdjustmentJournal(
  trx: Transaction<DB>,
  args: CreateAdjustmentJournalArgs
): Promise<string> {
  const journalEntryId = await getNextSequence(
    trx,
    "journalEntry",
    args.companyId
  );
  const journal = await trx
    .insertInto("journal")
    .values({
      journalEntryId,
      accountingPeriodId: args.accountingPeriodId,
      description: args.description,
      postingDate: args.postingDate,
      companyId: args.companyId,
      sourceType: args.sourceType ?? "Inventory Adjustment",
      status: args.status,
      postedAt: datetime.timestamp(),
      postedBy: args.userId,
      createdBy: args.userId
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  return journal.id;
}

// The open cost layers an INCREASE values itself against, per item. Same
// filters as calculateCOGS so both sides of the math agree: positive
// remaining quantity, not an adjustment child, and not a 'Purchase Order'
// planning artifact. Applied adjustment children (invoice-vs-receipt price
// corrections) are folded into each layer's `appliedChildCost`.
//
// Takes a LIST of items so the bulk importer reads every item it is about to
// post in a couple of queries instead of two per row. `bookAdjustment` passes
// one.
const CHILD_LAYER_CHUNK_SIZE = 500;

export async function loadOpenCostLayers(
  trx: Transaction<DB>,
  args: { itemIds: string[]; companyId: string }
): Promise<Map<string, OpenCostLayer[]>> {
  const byItem = new Map<string, OpenCostLayer[]>();
  if (args.itemIds.length === 0) return byItem;

  const openLayers = await trx
    .selectFrom("costLedger")
    .select(["id", "itemId", "quantity", "remainingQuantity", "cost"])
    .where("itemId", "in", args.itemIds)
    .where("companyId", "=", args.companyId)
    .where("remainingQuantity", ">", 0)
    .where("adjustment", "=", false)
    .where("appliesToCostLedgerId", "is", null)
    .where((eb) =>
      eb.or([
        eb("documentType", "is", null),
        eb("documentType", "!=", "Purchase Order")
      ])
    )
    .execute();
  if (openLayers.length === 0) return byItem;

  // The child lookup is chunked over the LAYER ids, not the item ids: open
  // layers are receipts not yet consumed, so their count is data-dependent and
  // unbounded. The bulk importer reaches here with every referenced item's
  // layers at once, and a single `in (...)` over them would exceed Postgres'
  // 65535 bind parameters on a large file against well-stocked items.
  const appliedChildCostByLayer = new Map<string, number>();
  const layerIds = openLayers.map((layer) => layer.id);
  for (let i = 0; i < layerIds.length; i += CHILD_LAYER_CHUNK_SIZE) {
    const children = await trx
      .selectFrom("costLedger")
      .select(["appliesToCostLedgerId", "cost"])
      .where(
        "appliesToCostLedgerId",
        "in",
        layerIds.slice(i, i + CHILD_LAYER_CHUNK_SIZE)
      )
      .where("companyId", "=", args.companyId)
      .execute();
    for (const child of children) {
      const key = child.appliesToCostLedgerId as string;
      appliedChildCostByLayer.set(
        key,
        (appliedChildCostByLayer.get(key) ?? 0) + Number(child.cost)
      );
    }
  }

  for (const layer of openLayers) {
    const itemId = layer.itemId as string;
    const list = byItem.get(itemId) ?? [];
    list.push({
      quantity: Number(layer.quantity),
      remainingQuantity: Number(layer.remainingQuantity),
      cost: Number(layer.cost),
      appliedChildCost: appliedChildCostByLayer.get(layer.id) ?? 0
    });
    byItem.set(itemId, list);
  }
  return byItem;
}

// Book one adjustment movement inside the caller's transaction: the item
// ledger row, then its valuation (`valueMovement`). Tracked-entity mutations
// are the caller's responsibility.
export async function bookAdjustment(
  trx: Transaction<DB>,
  args: BookAdjustmentArgs
): Promise<BookAdjustmentResult> {
  const { ledger, item, itemCost, accounting, skipValuation } = args;

  const inserted = await trx
    .insertInto("itemLedger")
    .values(
      buildItemLedgerRow({
        postingDate: ledger.postingDate,
        entryType: ledger.entryType,
        documentType: ledger.documentType,
        documentId: ledger.documentId,
        correctionOfItemLedgerId: ledger.correctionOfItemLedgerId,
        itemId: ledger.itemId,
        locationId: ledger.locationId,
        storageUnitId: ledger.storageUnitId,
        trackedEntityId: ledger.trackedEntityId,
        quantity: ledger.quantity,
        comment: ledger.comment,
        scrapReasonId: ledger.scrapReasonId,
        companyId: ledger.companyId,
        createdBy: ledger.createdBy
      })
    )
    .returning(["id"])
    .executeTakeFirstOrThrow();

  if (skipValuation) {
    return { itemLedgerId: inserted.id, journalId: null, cost: 0 };
  }

  const { journalId, cost } = await valueMovement(trx, {
    movement: {
      postingDate: ledger.postingDate,
      itemId: ledger.itemId,
      quantity: ledger.quantity,
      locationId: ledger.locationId,
      entryType: ledger.entryType,
      documentType: ledger.documentType,
      documentId: ledger.documentId ?? inserted.id,
      trackedEntityId: ledger.trackedEntityId,
      companyId: ledger.companyId
    },
    item,
    itemCost,
    accounting,
    fixedUnitCost: args.fixedUnitCost
  });

  return { itemLedgerId: inserted.id, journalId, cost };
}

export interface ValueMovementArgs {
  movement: {
    postingDate: string; // yyyy-MM-dd
    itemId: string;
    // SIGNED: < 0 relieves cost layers, > 0 opens one
    quantity: number;
    locationId: string | null;
    entryType: Database["public"]["Enums"]["itemLedgerType"];
    documentType?: Database["public"]["Enums"]["itemLedgerDocumentType"] | null;
    // costLedger.documentId and journalLine.documentId
    documentId: string;
    // The moved unit or batch; only a serial unit's is used for costing.
    trackedEntityId?: string | null;
    companyId: string;
  };
  item: BookAdjustmentArgs["item"];
  itemCost: AdjustmentItemCost;
  accounting: BookAdjustmentArgs["accounting"];
  fixedUnitCost?: number;
}

// Value a stock movement whose item ledger row the caller has already written:
// cost-layer maintenance (consume via calculateCOGS on decreases, open a layer
// at current cost — or `fixedUnitCost` — on increases) and, when the caller
// passes `accounting`, a balanced journal of the inventory account against
// the offset account: for every decrease, and for an increase with value. `bookAdjustment` is this plus the ledger
// row; maintenance consumption calls it directly because its ledger rows are
// written alongside tracked-entity splits.
export async function valueMovement(
  trx: Transaction<DB>,
  args: ValueMovementArgs
): Promise<{ journalId: string | null; cost: number }> {
  const { movement, item, itemCost, accounting } = args;
  const { companyId, documentId } = movement;

  if (!carriesAdjustmentValue(movement.quantity, item.itemTrackingType)) {
    return { journalId: null, cost: 0 };
  }

  const absQuantity = Math.abs(movement.quantity);
  // A serial unit's movement is costed by specific identification: an
  // increase books a layer that belongs to the unit, and a decrease relieves
  // that layer first (calculateCOGS / cost-layer-order.ts). A batch entity is
  // split and re-pointed as it moves, so its layers stay FIFO / LIFO.
  const serialId =
    item.itemTrackingType === "Serial"
      ? (movement.trackedEntityId ?? null)
      : null;
  let cost = 0;

  if (movement.quantity < 0) {
    // Decrease: relieve carrying value exactly as shipments do — consume
    // layers (FIFO/LIFO) / current cost (Average/Standard).
    const cogs = await calculateCOGS(trx, {
      itemId: movement.itemId,
      quantity: absQuantity,
      companyId,
      trackedEntityIds: serialId ? [serialId] : []
    });
    cost = cogs.totalCost;

    await trx
      .insertInto("costLedger")
      .values(
        buildCostLedgerRow({
          entryType: movement.entryType,
          documentType: movement.documentType,
          documentId,
          itemId: movement.itemId,
          quantity: -absQuantity,
          cost: -cogs.totalCost,
          postingDate: movement.postingDate,
          trackedEntityId: serialId,
          companyId
        })
      )
      .execute();
  } else if (args.fixedUnitCost != null) {
    // Increase at a caller-fixed unit cost: Unscrap restores stock at the
    // ORIGINAL scrapped cost so a scrap→unscrap round trip nets zero P&L.
    cost = absQuantity * args.fixedUnitCost;

    await trx
      .insertInto("costLedger")
      .values(
        buildCostLedgerRow({
          entryType: movement.entryType,
          documentType: movement.documentType,
          documentId,
          itemId: movement.itemId,
          quantity: absQuantity,
          cost,
          postingDate: movement.postingDate,
          trackedEntityId: serialId,
          companyId
        })
      )
      .execute();
  } else {
    // Increase: create a layer at the item's current carrying cost.
    const openLayers = await loadOpenCostLayers(trx, {
      itemIds: [movement.itemId],
      companyId
    });
    const unitCost = computeCurrentUnitCost(
      itemCost,
      openLayers.get(movement.itemId) ?? []
    );
    cost = absQuantity * unitCost;

    await trx
      .insertInto("costLedger")
      .values(
        buildCostLedgerRow({
          entryType: movement.entryType,
          documentType: movement.documentType,
          documentId,
          itemId: movement.itemId,
          quantity: absQuantity,
          cost,
          postingDate: movement.postingDate,
          trackedEntityId: serialId,
          companyId
        })
      )
      .execute();
  }

  // An inbound movement at no value posts no journal (nothing to tie out).
  // An outbound one always writes its pair, at zero too: every outbound cost
  // row carries a pair, because the accounting enable's re-cost may give it
  // a cost and adjusts the pair it finds. With no pair, and another journal
  // of the document that day, neither the legacy backfill (which skips a
  // document-day that has a journal) nor the re-cost could book the cost.
  if (!accounting || (cost === 0 && movement.quantity > 0)) {
    return { journalId: null, cost };
  }

  const journalId = accounting.getJournalId
    ? await accounting.getJournalId()
    : await createAdjustmentJournal(trx, {
        companyId,
        accountingPeriodId: accounting.accountingPeriodId,
        status: accounting.postingStatus,
        description: accounting.description,
        postingDate: movement.postingDate,
        userId: accounting.userId,
        sourceType: accounting.sourceType
      });

  const [inventoryLine, offsetLine] = buildAdjustmentJournalLines({
    journalId,
    documentId,
    documentType: movement.documentType,
    journalLineReference: nanoid(),
    isGain: movement.quantity > 0,
    cost,
    quantity: absQuantity,
    replenishmentSystem: item.replenishmentSystem,
    accountDefaults: accounting.accountDefaults,
    offsetAccount: accounting.offsetAccount,
    offsetDescription: accounting.offsetDescription,
    companyId
  });
  const journalLines = await trx
    .insertInto("journalLine")
    .values([inventoryLine, offsetLine])
    .returning(["id"])
    .execute();

  const journalLineDimensionInserts = buildJournalLineDimensions({
    journalLineIds: journalLines.map((line) => line.id),
    dimensions: accounting.dimensions ?? {},
    itemId: movement.itemId,
    itemPostingGroupId: item.itemPostingGroupId,
    locationId: movement.locationId,
    extraDimensions: accounting.extraDimensions,
    companyId
  });
  if (journalLineDimensionInserts.length > 0) {
    await trx
      .insertInto("journalLineDimension")
      .values(journalLineDimensionInserts)
      .execute();
  }

  return { journalId, cost };
}
