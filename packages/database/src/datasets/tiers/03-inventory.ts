import { insertId, insertRow, need, nextSequence } from "../sql.ts";
import type { Ctx } from "../types.ts";

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

  // ── Lots and serials on hand ──────────────────────────────────────────────
  // A batch- or serial-tracked part is only issuable if a tracked entity for it
  // is Available — without these the shop floor's scan-material picker is empty
  // even though the item shows stock.
  ctx.log("available lots and serials");
  for (const stock of data.onHandTracked) {
    const itemRef = need(ctx.refs.items, stock.item);
    for (const entity of stock.entities) {
      await insertId(ctx, "trackedEntity", {
        quantity: entity.quantity,
        status: "Available",
        sourceDocument: "Item",
        sourceDocumentId: itemRef.id,
        sourceDocumentReadableId: itemRef.readableId,
        readableId: entity.readableId,
        itemId: itemRef.id,
        attributes: JSON.stringify({}),
        updatedBy: userId
      });
    }
  }

  // ── Kanbans (auto-replenishment cards) for high-usage buy parts ───────────
  ctx.log("kanban cards");
  for (const kb of data.kanbanItems) {
    const itemRef = need(ctx.refs.items, kb.item);
    const supplierId = need(ctx.refs.suppliers, kb.supplier);
    await insertId(ctx, "kanban", {
      itemId: itemRef.id,
      replenishmentSystem: "Buy",
      quantity: kb.qty,
      locationId: plantId,
      supplierId,
      autoRelease: true
    });
  }

  // ── Inventory count (Draft state — Posted counts need the edge function) ──
  ctx.log("inventory count (draft)");
  const countId = await nextSequence(ctx, "inventoryCount");
  const icId = await insertId(ctx, "inventoryCount", {
    inventoryCountId: countId,
    locationId: plantId,
    status: data.inventoryCount.status,
    notes: data.inventoryCount.notes
  });

  // Add a few count lines for the items we put in stock
  const sampleLines = data.openingStock.slice(0, 6);
  for (const entry of sampleLines) {
    const itemRef = need(ctx.refs.items, entry.item);
    const shelfId = need(ctx.refs.shelves, entry.shelf);
    await insertId(ctx, "inventoryCountLine", {
      inventoryCountId: icId,
      itemId: itemRef.id,
      locationId: plantId,
      storageUnitId: shelfId
    });
  }

  ctx.refs.documents.inventoryCount = icId;
}
