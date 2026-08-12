import { insertId, insertRow, nextSequence } from "../sql.ts";
import type { Ctx } from "../types.ts";

// Opening inventory — realistic quantities for a smallsat shop.
// Parts that are bought (Buy replenishment) get stock; Make parts do not.
const OPENING_STOCK: Array<{
  item: string;
  qty: number;
  cost: number;
  shelf: string;
}> = [
  { item: "BAT-LIION-48V", qty: 3, cost: 2400, shelf: "A1-L2" },
  { item: "PCB-BARE-REV3", qty: 20, cost: 85, shelf: "A1-L1" },
  { item: "RW-010", qty: 4, cost: 14500, shelf: "A2-L2" },
  { item: "ST-050", qty: 2, cost: 28000, shelf: "A2-L3" },
  { item: "TXRX-SBAND", qty: 3, cost: 9500, shelf: "A2-L2" },
  { item: "THR-HYDRA-1N", qty: 4, cost: 6800, shelf: "A3-L1" },
  { item: "TANK-TI-4L", qty: 2, cost: 3200, shelf: "A3-L1" },
  { item: "VLV-SOLENOID-LP", qty: 8, cost: 950, shelf: "A3-L2" },
  { item: "FST-M4-TI", qty: 500, cost: 2.5, shelf: "A1-L1" },
  { item: "FST-M6-A286", qty: 200, cost: 5.5, shelf: "A1-L1" },
  { item: "BRG-6201", qty: 24, cost: 18, shelf: "A1-L3" },
  { item: "MAT-AL7075-PLT", qty: 60, cost: 12, shelf: "A2-L1" },
  { item: "MAT-CF-LAM", qty: 10, cost: 320, shelf: "CleanRoom" },
  { item: "MAT-GAAS-CELL", qty: 256, cost: 180, shelf: "CleanRoom" },
  { item: "MAT-KAPTON", qty: 50, cost: 45, shelf: "A1-L3" },
  { item: "MAT-SYLGARD", qty: 5, cost: 95, shelf: "A2-L1" },
  { item: "MAT-CONFCOAT", qty: 12, cost: 62, shelf: "A2-L1" },
  { item: "CN-MLI-001", qty: 4, cost: 380, shelf: "CleanRoom" },
  { item: "CN-GREASE-001", qty: 2, cost: 95, shelf: "A1-L3" }
];

export async function runTier3(ctx: Ctx): Promise<void> {
  const { companyId, userId, locationId } = ctx;
  const plantId = ctx.refs.locations.Plant ?? locationId;

  // ── Opening itemLedger entries (positive adjustments) ─────────────────────
  ctx.log("opening inventory balances");
  for (const entry of OPENING_STOCK) {
    const itemRef = ctx.refs.items[entry.item];
    const shelfId = ctx.refs.shelves[entry.shelf];
    if (!itemRef || !shelfId) continue;

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

  // ── Kanbans (auto-replenishment cards) for high-usage buy parts ───────────
  ctx.log("kanban cards");
  const kanbanItems: Array<{ item: string; qty: number; supplier: string }> = [
    { item: "FST-M4-TI", qty: 200, supplier: "SpaceGrade Fasteners" },
    { item: "FST-M6-A286", qty: 100, supplier: "SpaceGrade Fasteners" },
    { item: "PCB-BARE-REV3", qty: 10, supplier: "CelestialElex" }
  ];

  for (const kb of kanbanItems) {
    const itemRef = ctx.refs.items[kb.item];
    const supplierId = ctx.refs.suppliers[kb.supplier];
    if (!itemRef || !supplierId) continue;
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
    status: "Draft",
    notes: "Quarterly physical count — Q3"
  });

  // Add a few count lines for the items we put in stock
  const sampleLines = OPENING_STOCK.slice(0, 6);
  for (const entry of sampleLines) {
    const itemRef = ctx.refs.items[entry.item];
    const shelfId = ctx.refs.shelves[entry.shelf];
    if (!itemRef || !shelfId) continue;
    await insertId(ctx, "inventoryCountLine", {
      inventoryCountId: icId,
      itemId: itemRef.id,
      locationId: plantId,
      storageUnitId: shelfId
    });
  }

  ctx.refs.documents.inventoryCount = icId;
}
