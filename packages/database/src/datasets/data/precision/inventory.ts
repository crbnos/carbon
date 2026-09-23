import type {
  InventoryCountSpec,
  InventoryData,
  KanbanItemSpec,
  OpeningStockSpec,
  ShelfLifeSpec,
  StockTransferSpec,
  TrackedStockSpec,
  WarehouseTransferSpec
} from "../../types.ts";

// Opening inventory — realistic quantities for a contract machine shop.
// Parts that are bought (Buy replenishment) get stock; Make parts do not.
// Every `shelf` must match a ShelfSpec name in foundation.ts or the row is lost.
export const OPENING_STOCK: OpeningStockSpec[] = [
  { item: "HW-SHCS-M6", qty: 800, shelf: "B1-L1" },
  { item: "HW-SHCS-M10", qty: 500, shelf: "B1-L1" },
  { item: "HW-DOWEL-8", qty: 300, shelf: "B1-L2" },
  { item: "INS-HELI-M6", qty: 400, shelf: "B1-L2" },
  { item: "BRG-DBL-6205", qty: 24, shelf: "B1-L3" },
  { item: "BRG-NDL-HK1512", qty: 30, shelf: "B1-L3" },
  { item: "SEAL-ORING-224", qty: 600, shelf: "B2-L1" },
  { item: "SPR-DIE-25", qty: 120, shelf: "B2-L1" },
  { item: "PIN-CLEVIS-12", qty: 90, shelf: "B2-L2" },
  { item: "BSH-BRZ-2012", qty: 140, shelf: "B2-L2" },
  { item: "CYL-HYD-40", qty: 6, shelf: "B2-L3" },
  { item: "MAT-AL6061-BAR", qty: 626, shelf: "Bar-Stock" },
  { item: "MAT-AL5052-SHT", qty: 380, shelf: "Bar-Stock" },
  { item: "MAT-SS304-BAR", qty: 260, shelf: "Bar-Stock" },
  { item: "MAT-SS316-PLT", qty: 210, shelf: "Bar-Stock" },
  { item: "MAT-4140-BAR", qty: 340, shelf: "Bar-Stock" },
  { item: "MAT-CRS-TUBE", qty: 180, shelf: "Bar-Stock" },
  { item: "CN-COOLANT-55", qty: 3, shelf: "B3-L1" },
  { item: "CN-DEBURR-MED", qty: 90, shelf: "B3-L1" }
];

// Lots/serials that back the tracked slice of the opening stock above, plus
// the quality states a real stockroom carries: a bearing lot on hold pending
// paperwork, a rejected bar-stock lot awaiting disposition, and an aging
// bearing lot (paired with the itemShelfLife spec below).
export const ON_HAND_TRACKED: TrackedStockSpec[] = [
  {
    item: "BRG-DBL-6205",
    entities: [
      { readableId: "LOT-BRG-2611", quantity: 16 },
      { readableId: "LOT-BRG-2612", quantity: 8, expiresOffset: 30 },
      // Awaiting the vendor's grease-fill certificate before release.
      { readableId: "LOT-BRG-2613", quantity: 2, status: "On Hold" }
    ]
  },
  {
    item: "CYL-HYD-40",
    entities: [
      { readableId: "CYL40-SN-0101", quantity: 1 },
      { readableId: "CYL40-SN-0102", quantity: 1 },
      { readableId: "CYL40-SN-0103", quantity: 1 },
      { readableId: "CYL40-SN-0104", quantity: 1 },
      { readableId: "CYL40-SN-0105", quantity: 1 },
      { readableId: "CYL40-SN-0106", quantity: 1 }
    ]
  },
  {
    item: "MAT-AL6061-BAR",
    entities: [
      { readableId: "LOT-AL6061-2610", quantity: 400 },
      { readableId: "LOT-AL6061-2611", quantity: 220 },
      // Mill cert doesn't match the heat number — quarantined for MRB.
      { readableId: "LOT-AL6061-2612", quantity: 3, status: "Rejected" },
      // Bar ends out of straightness after a rack collapse — scrapped.
      {
        readableId: "LOT-AL6061-2605",
        quantity: 6,
        status: "Scrapped",
        scrap: {
          shelf: "Bar-Stock",
          reason: "Damaged",
          dateOffset: -41,
          comment:
            "Bars bowed beyond straightness tolerance after a rack collapse"
        }
      }
    ]
  }
];

// Sealed bearings age: the grease fill carries a 1-year shelf life, with
// LOT-BRG-2612 above expiring in 30 days so the expiry chips have something
// amber to show.
export const SHELF_LIVES: ShelfLifeSpec[] = [
  { item: "BRG-DBL-6205", days: 365 }
];

// Kanbans (auto-replenishment cards): Buy cards for high-usage buy parts, a
// Make card for the machined spacer kit, and a Transfer card feeding the
// deburr bench.
export const KANBAN_ITEMS: KanbanItemSpec[] = [
  { item: "HW-SHCS-M6", qty: 250, supplier: "Fastline Industrial Supply" },
  { item: "HW-SHCS-M10", qty: 150, supplier: "Fastline Industrial Supply" },
  { item: "SEAL-ORING-224", qty: 200, supplier: "Midway Bearing & Seal" },
  { item: "MCH-SPACER-KIT", qty: 5, replenishmentSystem: "Make" },
  {
    item: "CN-DEBURR-MED",
    qty: 20,
    replenishmentSystem: "Transfer",
    fromShelf: "B3-L1",
    toShelf: "B3-L2"
  }
];

export const INVENTORY_COUNTS: InventoryCountSpec[] = [
  {
    // The first six opening-stock rows.
    key: "q3-draft",
    status: "Draft",
    notes: "Cycle count — hardware bins and bar stock racking",
    lines: [
      {
        item: "HW-SHCS-M6",
        shelf: "B1-L1",
        snapshotQuantity: 800,
        countedQuantity: 800
      },
      {
        item: "HW-SHCS-M10",
        shelf: "B1-L1",
        snapshotQuantity: 500,
        countedQuantity: 500
      },
      {
        item: "HW-DOWEL-8",
        shelf: "B1-L2",
        snapshotQuantity: 300,
        countedQuantity: 300
      },
      {
        item: "INS-HELI-M6",
        shelf: "B1-L2",
        snapshotQuantity: 400,
        countedQuantity: 400
      },
      {
        item: "BRG-DBL-6205",
        shelf: "B1-L3",
        snapshotQuantity: 24,
        countedQuantity: 24
      },
      {
        item: "BRG-NDL-HK1512",
        shelf: "B1-L3",
        snapshotQuantity: 30,
        countedQuantity: 30
      }
    ]
  },
  {
    // August cycle count over the hardware aisle: two small variances (a
    // couple of cap screws short in the bin, two dowels found loose behind
    // the divider).
    key: "aug-cycle",
    status: "Posted",
    notes: "Cycle count — fastener & hardware bins",
    postedOffset: -20,
    lines: [
      {
        item: "HW-SHCS-M6",
        shelf: "B1-L1",
        snapshotQuantity: 800,
        countedQuantity: 798
      },
      {
        item: "HW-SHCS-M10",
        shelf: "B1-L1",
        snapshotQuantity: 500,
        countedQuantity: 500
      },
      {
        item: "HW-DOWEL-8",
        shelf: "B1-L2",
        snapshotQuantity: 300,
        countedQuantity: 302
      },
      {
        item: "INS-HELI-M6",
        shelf: "B1-L2",
        snapshotQuantity: 400,
        countedQuantity: 400
      },
      {
        item: "SEAL-ORING-224",
        shelf: "B2-L1",
        snapshotQuantity: 600,
        countedQuantity: 600
      }
    ]
  }
];

// Shelf → shelf moves inside the plant, one per status. Only the Completed one
// (dated AFTER the posted count above) actually moved stock.
export const STOCK_TRANSFERS: StockTransferSpec[] = [
  {
    key: "st-completed",
    status: "Completed",
    fromShelf: "B1-L1",
    toShelf: "B1-L2",
    dateOffset: -10,
    lines: [{ item: "HW-SHCS-M6", quantity: 100 }]
  },
  {
    key: "st-released",
    status: "Released",
    fromShelf: "B1-L1",
    toShelf: "B2-L3",
    dateOffset: -1,
    lines: [{ item: "HW-SHCS-M10", quantity: 50 }]
  },
  {
    key: "st-draft",
    status: "Draft",
    fromShelf: "B2-L1",
    toShelf: "B2-L2",
    dateOffset: 0,
    lines: [{ item: "SPR-DIE-25", quantity: 12 }]
  }
];

// Plant → HQ transfers, one per status. HQ keeps a small engineering stash of
// common hardware; it has no bins, so completed receipts land shelfless.
export const WAREHOUSE_TRANSFERS: WarehouseTransferSpec[] = [
  {
    key: "wt-completed",
    status: "Completed",
    fromLocation: "Plant",
    toLocation: "HQ",
    dateOffset: -12,
    lines: [{ item: "HW-SHCS-M10", quantity: 25, fromShelf: "B1-L1" }]
  },
  {
    key: "wt-toship",
    status: "To Ship",
    fromLocation: "Plant",
    toLocation: "HQ",
    dateOffset: 0,
    lines: [{ item: "PIN-CLEVIS-12", quantity: 10, fromShelf: "B2-L2" }]
  },
  {
    key: "wt-draft",
    status: "Draft",
    fromLocation: "Plant",
    toLocation: "HQ",
    dateOffset: 2,
    lines: [{ item: "BSH-BRZ-2012", quantity: 8, fromShelf: "B2-L2" }]
  }
];

export const precisionInventory: InventoryData = {
  openingStock: OPENING_STOCK,
  onHandTracked: ON_HAND_TRACKED,
  kanbanItems: KANBAN_ITEMS,
  inventoryCounts: INVENTORY_COUNTS,
  shelfLives: SHELF_LIVES,
  stockTransfers: STOCK_TRANSFERS,
  warehouseTransfers: WAREHOUSE_TRANSFERS
};
