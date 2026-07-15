import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { Transaction } from "kysely";
import { DB } from "../lib/database.ts";
import { Database } from "../lib/types.ts";
import { credit, debit } from "../lib/utils.ts";
import { calculateCOGS } from "./calculate-cogs.ts";
import { getNextSequence } from "./get-next-sequence.ts";
import { resolveInventoryAccount } from "./get-posting-group.ts";
import {
  AdjustmentItemCost,
  computeCurrentUnitCost,
} from "./post-adjustment-cost.ts";

export { computeCurrentUnitCost } from "./post-adjustment-cost.ts";
export type {
  AdjustmentItemCost,
  OpenCostLayer,
} from "./post-adjustment-cost.ts";

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
    // today's shape; 'Inventory Adjustment' exists only on journalLineDocumentType)
    documentType?: "Inventory Count" | null;
    documentId?: string | null;
    correctionOfItemLedgerId?: string | null;
    comment?: string | null;
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
  // null ⇒ accounting disabled: ledger + cost layers only, no journal
  accounting: {
    accountingPeriodId: string;
    accountDefaults: {
      rawMaterialsAccount: string;
      finishedGoodsAccount: string;
      inventoryAdjustmentVarianceAccount: string;
    };
    description: string;
    userId: string;
    // active dimensions for the company group, entityType → dimension id
    // (Item / ItemPostingGroup / Location are consulted) — journal lines get
    // journalLineDimension tags for whichever are configured
    dimensions?: Record<string, string>;
  } | null;
  // storage-unit-transfer legs move stock between bins without changing its
  // value: ledger row only — no cost layers, no journal
  skipValuation?: boolean;
}

export interface BookAdjustmentResult {
  itemLedgerId: string;
  journalId: string | null;
  cost: number;
}

// Book one adjustment movement inside the caller's transaction: the item
// ledger row, cost-layer maintenance (consume via calculateCOGS on decreases,
// create a layer at current cost on increases), and — when accounting is
// enabled and the movement carries value — a balanced journal against the
// inventory adjustment variance account. Tracked-entity mutations are the
// caller's responsibility.
export async function bookAdjustment(
  trx: Transaction<DB>,
  args: BookAdjustmentArgs
): Promise<BookAdjustmentResult> {
  const { ledger, item, itemCost, accounting, skipValuation } = args;
  const { companyId } = ledger;

  const inserted = await trx
    .insertInto("itemLedger")
    .values({
      postingDate: ledger.postingDate,
      entryType: ledger.entryType,
      documentType: ledger.documentType ?? null,
      documentId: ledger.documentId ?? null,
      correctionOfItemLedgerId: ledger.correctionOfItemLedgerId ?? null,
      itemId: ledger.itemId,
      locationId: ledger.locationId,
      storageUnitId: ledger.storageUnitId,
      trackedEntityId: ledger.trackedEntityId,
      quantity: ledger.quantity,
      comment: ledger.comment ?? null,
      companyId,
      createdBy: ledger.createdBy,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  if (
    skipValuation ||
    item.itemTrackingType === "Non-Inventory" ||
    ledger.quantity === 0
  ) {
    return { itemLedgerId: inserted.id, journalId: null, cost: 0 };
  }

  const absQuantity = Math.abs(ledger.quantity);
  const documentId = ledger.documentId ?? inserted.id;
  let cost = 0;

  if (ledger.quantity < 0) {
    // Decrease: relieve carrying value exactly as shipments do — consume
    // layers (FIFO/LIFO) / current cost (Average/Standard).
    const cogs = await calculateCOGS(trx, {
      itemId: ledger.itemId,
      quantity: absQuantity,
      companyId,
    });
    cost = cogs.totalCost;

    await trx
      .insertInto("costLedger")
      .values({
        itemLedgerType: ledger.entryType,
        costLedgerType: "Direct Cost",
        adjustment: false,
        documentType: ledger.documentType ?? null,
        documentId,
        itemId: ledger.itemId,
        quantity: -absQuantity,
        cost: -cogs.totalCost,
        remainingQuantity: 0,
        companyId,
      })
      .execute();
  } else {
    // Increase: create a layer at the item's current carrying cost. Same
    // open-layer filters as calculateCOGS so both sides of the math agree.
    const openLayers = await trx
      .selectFrom("costLedger")
      .select(["id", "quantity", "remainingQuantity", "cost"])
      .where("itemId", "=", ledger.itemId)
      .where("companyId", "=", companyId)
      .where("remainingQuantity", ">", 0)
      .where("adjustment", "=", false)
      .where("appliesToCostLedgerId", "is", null)
      .where((eb) =>
        eb.or([
          eb("documentType", "is", null),
          eb("documentType", "!=", "Purchase Order"),
        ])
      )
      .execute();

    const appliedChildCostByLayer = new Map<string, number>();
    if (openLayers.length > 0) {
      const children = await trx
        .selectFrom("costLedger")
        .select(["appliesToCostLedgerId", "cost"])
        .where(
          "appliesToCostLedgerId",
          "in",
          openLayers.map((layer) => layer.id)
        )
        .execute();
      for (const child of children) {
        const key = child.appliesToCostLedgerId as string;
        appliedChildCostByLayer.set(
          key,
          (appliedChildCostByLayer.get(key) ?? 0) + Number(child.cost)
        );
      }
    }

    const unitCost = computeCurrentUnitCost(
      itemCost,
      openLayers.map((layer) => ({
        quantity: Number(layer.quantity),
        remainingQuantity: Number(layer.remainingQuantity),
        cost: Number(layer.cost),
        appliedChildCost: appliedChildCostByLayer.get(layer.id) ?? 0,
      }))
    );
    cost = absQuantity * unitCost;

    await trx
      .insertInto("costLedger")
      .values({
        itemLedgerType: ledger.entryType,
        costLedgerType: "Direct Cost",
        adjustment: false,
        documentType: ledger.documentType ?? null,
        documentId,
        itemId: ledger.itemId,
        quantity: absQuantity,
        cost,
        remainingQuantity: absQuantity,
        companyId,
      })
      .execute();
  }

  // A zero-value movement posts no journal (nothing to tie out; a $0-net
  // entry is noise).
  if (!accounting || cost === 0) {
    return { itemLedgerId: inserted.id, journalId: null, cost };
  }

  const journalEntryId = await getNextSequence(trx, "journalEntry", companyId);

  const journal = await trx
    .insertInto("journal")
    .values({
      journalEntryId,
      accountingPeriodId: accounting.accountingPeriodId,
      description: accounting.description,
      postingDate: ledger.postingDate,
      companyId,
      sourceType: "Inventory Adjustment",
      status: "Posted",
      postedAt: new Date().toISOString(),
      postedBy: accounting.userId,
      createdBy: accounting.userId,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  const inventoryAccount = resolveInventoryAccount(
    item.replenishmentSystem,
    accounting.accountDefaults
  );
  const journalLineReference = nanoid();
  const journalLineDocumentType = ledger.documentType ?? "Inventory Adjustment";
  const isGain = ledger.quantity > 0;

  const journalLines = await trx
    .insertInto("journalLine")
    .values([
      {
        journalId: journal.id,
        accountId: inventoryAccount.account,
        description: inventoryAccount.description,
        amount: isGain ? debit("asset", cost) : credit("asset", cost),
        quantity: absQuantity,
        documentType: journalLineDocumentType,
        documentId,
        journalLineReference,
        companyId,
      },
      {
        journalId: journal.id,
        accountId: accounting.accountDefaults.inventoryAdjustmentVarianceAccount,
        description: "Inventory Adjustment",
        amount: isGain ? credit("expense", cost) : debit("expense", cost),
        quantity: absQuantity,
        documentType: journalLineDocumentType,
        documentId,
        journalLineReference,
        companyId,
      },
    ])
    .returning(["id"])
    .execute();

  // Dimension tags (post-shipment precedent): every line of the entry gets
  // the movement's Item / ItemPostingGroup / Location, for whichever
  // dimensions are active on the company group.
  const dimensions = accounting.dimensions ?? {};
  const dimensionValues: Array<[string, string | null | undefined]> = [
    ["Item", ledger.itemId],
    ["ItemPostingGroup", item.itemPostingGroupId],
    ["Location", ledger.locationId],
  ];
  const journalLineDimensionInserts = journalLines.flatMap((line) =>
    dimensionValues
      .filter(([entityType, valueId]) => dimensions[entityType] && valueId)
      .map(([entityType, valueId]) => ({
        journalLineId: line.id,
        dimensionId: dimensions[entityType],
        valueId: valueId as string,
        companyId,
      }))
  );
  if (journalLineDimensionInserts.length > 0) {
    await trx
      .insertInto("journalLineDimension")
      .values(journalLineDimensionInserts)
      .execute();
  }

  return { itemLedgerId: inserted.id, journalId: journal.id, cost };
}
