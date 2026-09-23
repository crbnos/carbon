import { resolveDate, resolveTimestamp } from "../dates.ts";
import { bootstrapIdByName } from "../helpers/bootstrap-lookup.ts";
import { insertId, insertRow, need, nextSequence } from "../sql.ts";
import type { Ctx, TrackedStockSpec } from "../types.ts";

/**
 * Mirrors post-inventory-adjustment's full-entity Scrap: the entity keeps its
 * quantity, a Scrap activity consumes it and a Negative Adjmt. ledger row draws
 * it off the shelf. Tier 09 posts its cost row and scrap-account journal.
 */
async function scrapLot(
  ctx: Ctx,
  entity: TrackedStockSpec["entities"][number],
  itemRef: { id: string; readableId: string }
): Promise<void> {
  const scrap = entity.scrap;
  if (!scrap) {
    throw new Error(
      `Seed: Scrapped lot "${entity.readableId}" has no scrap spec`
    );
  }
  const entityId = need(ctx.refs.misc, `te:${entity.readableId}`);
  const reasonId = await bootstrapIdByName(ctx, "scrapReason", scrap.reason);
  const activityId = await insertId(ctx, "trackedActivity", {
    type: "Scrap",
    sourceDocument: "Item",
    sourceDocumentId: itemRef.id,
    sourceDocumentReadableId: itemRef.readableId,
    attributes: JSON.stringify({
      "Scrap Reason": reasonId,
      Employee: ctx.userId,
      Notes: scrap.comment
    }),
    updatedBy: ctx.userId
  });
  await insertRow(ctx, "trackedActivityInput", {
    trackedActivityId: activityId,
    trackedEntityId: entityId,
    quantity: entity.quantity,
    updatedBy: ctx.userId
  });
  await insertRow(ctx, "itemLedger", {
    entryType: "Negative Adjmt.",
    documentType: "Scrap",
    scrapReasonId: reasonId,
    postingDate: resolveDate(ctx.anchor, scrap.dateOffset),
    itemId: itemRef.id,
    locationId: ctx.refs.locations.Plant ?? ctx.locationId,
    storageUnitId: need(ctx.refs.shelves, scrap.shelf),
    trackedEntityId: entityId,
    quantity: -entity.quantity,
    comment: scrap.comment
  });
}

export async function runTier3(ctx: Ctx): Promise<void> {
  const { companyId, userId, locationId } = ctx;
  const data = ctx.dataset.inventory;
  const plantId = ctx.refs.locations.Plant ?? locationId;

  // ── Opening itemLedger entries (positive adjustments) ─────────────────────
  ctx.log("opening inventory balances");
  for (const entry of data.openingStock) {
    const itemRef = need(ctx.refs.items, entry.item);
    const shelfId = need(ctx.refs.shelves, entry.shelf);

    await insertRow(ctx, "itemLedger", {
      entryType: "Positive Adjmt.",
      documentType: "Inventory Receipt",
      itemId: itemRef.id,
      locationId: plantId,
      storageUnitId: shelfId,
      quantity: entry.qty,
      companyId,
      createdBy: userId,
      comment: "Opening balance"
    });
  }

  // Default shelf per stocked item at the plant: its first opening-stock bin.
  ctx.log("pick methods");
  const defaultShelf = new Map<string, string>();
  for (const entry of data.openingStock) {
    if (!defaultShelf.has(entry.item))
      defaultShelf.set(entry.item, entry.shelf);
  }
  for (const [item, shelf] of defaultShelf) {
    await insertRow(ctx, "pickMethod", {
      itemId: need(ctx.refs.items, item).id,
      locationId: plantId,
      defaultStorageUnitId: need(ctx.refs.shelves, shelf)
    });
  }

  // ── Lots and serials on hand ──────────────────────────────────────────────
  // A batch- or serial-tracked part is only issuable if a tracked entity for it
  // is Available — without these the shop floor's scan-material picker is empty
  // even though the item shows stock. A Scrapped lot also gets the scrap
  // posting (scrapLot).
  ctx.log("lots and serials");
  for (const stock of data.onHandTracked) {
    const itemRef = need(ctx.refs.items, stock.item);
    for (const entity of stock.entities) {
      // Registered so quality can hang an NCR on a specific lot (tier 07).
      ctx.refs.misc[`te:${entity.readableId}`] = await insertId(
        ctx,
        "trackedEntity",
        {
          quantity: entity.quantity,
          status: entity.status ?? "Available",
          sourceDocument: "Item",
          sourceDocumentId: itemRef.id,
          sourceDocumentReadableId: itemRef.readableId,
          readableId: entity.readableId,
          itemId: itemRef.id,
          attributes: JSON.stringify({}),
          expirationDate:
            entity.expiresOffset !== undefined
              ? resolveDate(ctx.anchor, entity.expiresOffset)
              : undefined,
          updatedBy: userId
        }
      );
      if (entity.status === "Scrapped") await scrapLot(ctx, entity, itemRef);
    }
  }

  // ── Shelf life (Fixed Duration) on batch-tracked items ────────────────────
  ctx.log("item shelf lives");
  for (const shelfLife of data.shelfLives) {
    const itemRef = need(ctx.refs.items, shelfLife.item);
    await insertRow(ctx, "itemShelfLife", {
      itemId: itemRef.id,
      mode: "Fixed Duration",
      days: shelfLife.days
    });
  }

  // ── Kanbans (auto-replenishment cards) ────────────────────────────────────
  ctx.log("kanban cards");
  for (const kb of data.kanbanItems) {
    const itemRef = need(ctx.refs.items, kb.item);
    const system = kb.replenishmentSystem ?? "Buy";
    // Transfer cards need two distinct bins (kanbanValidator; validate.ts mirrors it).
    if (system === "Buy" && kb.supplier === undefined) {
      throw new Error(`Seed: Buy kanban for "${kb.item}" has no supplier`);
    }
    if (system === "Transfer" && (!kb.fromShelf || !kb.toShelf)) {
      throw new Error(
        `Seed: Transfer kanban for "${kb.item}" needs fromShelf and toShelf`
      );
    }
    await insertId(ctx, "kanban", {
      itemId: itemRef.id,
      replenishmentSystem: system,
      quantity: kb.qty,
      locationId: plantId,
      supplierId:
        system === "Buy" && kb.supplier !== undefined
          ? need(ctx.refs.suppliers, kb.supplier)
          : undefined,
      fromStorageUnitId:
        system === "Transfer" && kb.fromShelf
          ? need(ctx.refs.shelves, kb.fromShelf)
          : undefined,
      storageUnitId:
        system === "Transfer" && kb.toShelf
          ? need(ctx.refs.shelves, kb.toShelf)
          : undefined,
      autoRelease: true
    });
  }

  // ── Inventory counts ──────────────────────────────────────────────────────
  // Draft = the app's pre-snapshot state (bare lines). Posted mirrors
  // post-inventory-count: frozen quantities plus one adjustment ledger row per
  // variance, linked back through postedItemLedgerId.
  for (const count of data.inventoryCounts) {
    ctx.log(`inventory count (${count.status.toLowerCase()})`);
    const readableId = await nextSequence(ctx, "inventoryCount");
    const posted = count.status === "Posted";
    if (posted && count.postedOffset === undefined) {
      throw new Error(
        `Seed: inventory count "${count.key}" is Posted but has no postedOffset`
      );
    }
    const postedAt = posted
      ? resolveTimestamp(ctx.anchor, count.postedOffset ?? 0, "16:00:00")
      : undefined;
    const icId = await insertId(ctx, "inventoryCount", {
      inventoryCountId: readableId,
      locationId: plantId,
      status: count.status,
      notes: count.notes,
      snapshotAt: postedAt,
      postedAt,
      postedBy: posted ? userId : undefined
    });

    for (const line of count.lines) {
      const itemRef = need(ctx.refs.items, line.item);
      const shelfId = need(ctx.refs.shelves, line.shelf);
      if (!posted) {
        await insertId(ctx, "inventoryCountLine", {
          inventoryCountId: icId,
          itemId: itemRef.id,
          locationId: plantId,
          storageUnitId: shelfId
        });
        continue;
      }

      const delta = line.countedQuantity - line.snapshotQuantity;
      let postedItemLedgerId: string | undefined;
      if (delta !== 0) {
        postedItemLedgerId = await insertId(ctx, "itemLedger", {
          entryType: delta > 0 ? "Positive Adjmt." : "Negative Adjmt.",
          documentType: "Inventory Count",
          documentId: icId,
          itemId: itemRef.id,
          locationId: plantId,
          storageUnitId: shelfId,
          quantity: delta,
          postingDate: resolveDate(ctx.anchor, count.postedOffset ?? 0),
          comment: `Inventory Count ${readableId}`,
          companyId,
          createdBy: userId
        });
      }
      await insertId(ctx, "inventoryCountLine", {
        inventoryCountId: icId,
        itemId: itemRef.id,
        locationId: plantId,
        storageUnitId: shelfId,
        systemQuantity: line.snapshotQuantity,
        countedQuantity: line.countedQuantity,
        countedAt: postedAt,
        countedBy: userId,
        postedItemLedgerId
      });
    }

    ctx.refs.documents[`ic:${count.key}`] = icId;
  }

  // ── Stock transfers (shelf → shelf inside the plant) ──────────────────────
  // Completed mirrors post-stock-transfer's "inventory" case: a Direct Transfer
  // ledger pair per line. Draft/Released move nothing yet.
  ctx.log("stock transfers");
  for (const transfer of data.stockTransfers) {
    const readableId = await nextSequence(ctx, "stockTransfer");
    const fromShelfId = need(ctx.refs.shelves, transfer.fromShelf);
    const toShelfId = need(ctx.refs.shelves, transfer.toShelf);
    const completed = transfer.status === "Completed";
    const createdAt = resolveTimestamp(
      ctx.anchor,
      transfer.dateOffset,
      "09:00:00"
    );
    const stId = await insertId(ctx, "stockTransfer", {
      stockTransferId: readableId,
      locationId: plantId,
      status: transfer.status,
      createdAt,
      completedAt: completed
        ? resolveTimestamp(ctx.anchor, transfer.dateOffset, "15:30:00")
        : undefined
    });

    for (const line of transfer.lines) {
      const itemRef = need(ctx.refs.items, line.item);
      await insertId(ctx, "stockTransferLine", {
        stockTransferId: stId,
        itemId: itemRef.id,
        quantity: line.quantity,
        pickedQuantity: completed ? line.quantity : 0,
        fromStorageUnitId: fromShelfId,
        toStorageUnitId: toShelfId
      });
      if (completed) {
        const postingDate = resolveDate(ctx.anchor, transfer.dateOffset);
        await insertRow(ctx, "itemLedger", {
          entryType: "Transfer",
          documentType: "Direct Transfer",
          documentId: stId,
          itemId: itemRef.id,
          locationId: plantId,
          storageUnitId: fromShelfId,
          quantity: -line.quantity,
          postingDate,
          companyId,
          createdBy: userId
        });
        await insertRow(ctx, "itemLedger", {
          entryType: "Transfer",
          documentType: "Direct Transfer",
          documentId: stId,
          itemId: itemRef.id,
          locationId: plantId,
          storageUnitId: toShelfId,
          quantity: line.quantity,
          postingDate,
          companyId,
          createdBy: userId
        });
      }
    }

    ctx.refs.documents[`st:${transfer.key}`] = stId;
  }

  // ── Warehouse transfers (location → location) ─────────────────────────────
  // Completed mirrors post-shipment + post-receipt: a Transfer Shipment row out
  // of the from-shelf and a shelfless Transfer Receipt (HQ has no bins; the app
  // does the same), documentId = the READABLE transferId.
  ctx.log("warehouse transfers");
  for (const transfer of data.warehouseTransfers) {
    const readableId = await nextSequence(ctx, "warehouseTransfer");
    const fromLocationId = need(ctx.refs.locations, transfer.fromLocation);
    const toLocationId = need(ctx.refs.locations, transfer.toLocation);
    const completed = transfer.status === "Completed";
    const wtId = await insertId(ctx, "warehouseTransfer", {
      transferId: readableId,
      fromLocationId,
      toLocationId,
      status: transfer.status,
      transferDate: resolveDate(ctx.anchor, transfer.dateOffset),
      expectedReceiptDate: resolveDate(ctx.anchor, transfer.dateOffset + 5)
    });

    for (const line of transfer.lines) {
      const itemRef = need(ctx.refs.items, line.item);
      const fromShelfId =
        line.fromShelf !== undefined
          ? need(ctx.refs.shelves, line.fromShelf)
          : undefined;
      await insertId(ctx, "warehouseTransferLine", {
        transferId: wtId,
        itemId: itemRef.id,
        quantity: line.quantity,
        fromLocationId,
        toLocationId,
        fromStorageUnitId: fromShelfId,
        unitOfMeasureCode: itemRef.unitOfMeasureCode,
        shippedQuantity: completed ? line.quantity : 0,
        receivedQuantity: completed ? line.quantity : 0
      });
      if (completed) {
        const postingDate = resolveDate(ctx.anchor, transfer.dateOffset);
        await insertRow(ctx, "itemLedger", {
          entryType: "Transfer",
          documentType: "Transfer Shipment",
          documentId: readableId,
          itemId: itemRef.id,
          locationId: fromLocationId,
          storageUnitId: fromShelfId,
          quantity: -line.quantity,
          postingDate,
          companyId,
          createdBy: userId
        });
        await insertRow(ctx, "itemLedger", {
          entryType: "Transfer",
          documentType: "Transfer Receipt",
          documentId: readableId,
          itemId: itemRef.id,
          locationId: toLocationId,
          quantity: line.quantity,
          postingDate,
          companyId,
          createdBy: userId
        });
      }
    }

    ctx.refs.documents[`wt:${transfer.key}`] = wtId;
  }
}
