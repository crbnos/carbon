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

// Opening inventory — realistic quantities for a precision motor shop.
// Parts that are bought (Buy replenishment) get stock; Make parts do not.
// Every `shelf` must match a ShelfSpec name in foundation.ts or the row is lost.
export const OPENING_STOCK: OpeningStockSpec[] = [
  { item: "MAG-NDFB-45", qty: 480, shelf: "Magnet-Vault" },
  { item: "MAG-NDFB-38", qty: 360, shelf: "Magnet-Vault" },
  { item: "BRG-6206-C3", qty: 60, shelf: "A2-L1" },
  { item: "BRG-6308-C3", qty: 44, shelf: "A2-L1" },
  { item: "SEAL-VR-45", qty: 120, shelf: "A1-L2" },
  { item: "ENC-INC-2048", qty: 6, shelf: "A1-L3" },
  { item: "TRM-BLK-6P", qty: 75, shelf: "A1-L2" },
  { item: "FAN-AX-160", qty: 28, shelf: "A2-L3" },
  { item: "FST-M6-SS", qty: 900, shelf: "A1-L1" },
  { item: "FST-M10-SS", qty: 500, shelf: "A1-L1" },
  { item: "NPL-SS-STD", qty: 150, shelf: "A1-L3" },
  { item: "MAT-LAM-M19", qty: 2440, shelf: "A3-L1" },
  { item: "MAT-CU-18AWG", qty: 640, shelf: "Winding-Crib" },
  { item: "MAT-INS-NOMEX", qty: 85, shelf: "Winding-Crib" },
  { item: "MAT-VARNISH", qty: 22, shelf: "A3-L3" },
  { item: "MAT-AL6061-BAR", qty: 720, shelf: "A3-L2" },
  { item: "MAT-STL-4140", qty: 540, shelf: "A3-L2" },
  { item: "CN-EPOXY-MAG", qty: 4, shelf: "A1-L3" },
  { item: "CN-BRG-GREASE", qty: 12, shelf: "A2-L2" }
];

// Backs the tracked slice of the opening stock above.
export const ON_HAND_TRACKED: TrackedStockSpec[] = [
  {
    item: "MAG-NDFB-45",
    entities: [
      { readableId: "LOT-MAG45-2607", quantity: 300 },
      { readableId: "LOT-MAG45-2608", quantity: 180 },
      { readableId: "LOT-MAG45-2609", quantity: 3, status: "On Hold" }
    ]
  },
  {
    item: "MAG-NDFB-38",
    entities: [
      { readableId: "LOT-MAG38-2606", quantity: 200 },
      { readableId: "LOT-MAG38-2607", quantity: 160 }
    ]
  },
  {
    item: "ENC-INC-2048",
    entities: [
      { readableId: "ENC2048-SN-0031", quantity: 1 },
      { readableId: "ENC2048-SN-0032", quantity: 1 },
      { readableId: "ENC2048-SN-0033", quantity: 1 },
      { readableId: "ENC2048-SN-0034", quantity: 1 },
      { readableId: "ENC2048-SN-0035", quantity: 1 },
      { readableId: "ENC2048-SN-0036", quantity: 1 }
    ]
  },
  {
    item: "MAT-LAM-M19",
    entities: [
      { readableId: "LOT-M19-2606", quantity: 1400 },
      { readableId: "LOT-M19-2607", quantity: 1000 },
      { readableId: "LOT-M19-2608", quantity: 3, status: "Rejected" },
      {
        readableId: "LOT-M19-2601",
        quantity: 40,
        status: "Scrapped",
        scrap: {
          shelf: "A3-L1",
          reason: "Quality",
          dateOffset: -36,
          comment:
            "Insulating coating flaked after a humidity excursion in storage"
        }
      }
    ]
  },
  {
    item: "MAT-CU-18AWG",
    entities: [
      { readableId: "LOT-CU18-2608", quantity: 400 },
      { readableId: "LOT-CU18-2609", quantity: 240, expiresOffset: 30 }
    ]
  }
];

// LOT-CU18-2609 above expires in 30 days so the expiry chips show amber.
export const SHELF_LIVES: ShelfLifeSpec[] = [
  { item: "MAT-CU-18AWG", days: 270 }
];

export const KANBAN_ITEMS: KanbanItemSpec[] = [
  { item: "FST-M6-SS", qty: 300, supplier: "Ironwood Fasteners" },
  { item: "FST-M10-SS", qty: 150, supplier: "Ironwood Fasteners" },
  { item: "SEAL-VR-45", qty: 40, supplier: "Summit Bearing Supply" },
  { item: "SHF-9000", qty: 2, replenishmentSystem: "Make" },
  {
    item: "MAT-VARNISH",
    qty: 5,
    replenishmentSystem: "Transfer",
    fromShelf: "A3-L3",
    toShelf: "Winding-Crib"
  }
];

export const INVENTORY_COUNTS: InventoryCountSpec[] = [
  {
    // The first six opening-stock rows.
    key: "q3-draft",
    status: "Draft",
    notes: "Quarterly physical count — magnet vault and winding crib",
    lines: [
      {
        item: "MAG-NDFB-45",
        shelf: "Magnet-Vault",
        snapshotQuantity: 480,
        countedQuantity: 480
      },
      {
        item: "MAG-NDFB-38",
        shelf: "Magnet-Vault",
        snapshotQuantity: 360,
        countedQuantity: 360
      },
      {
        item: "BRG-6206-C3",
        shelf: "A2-L1",
        snapshotQuantity: 60,
        countedQuantity: 60
      },
      {
        item: "BRG-6308-C3",
        shelf: "A2-L1",
        snapshotQuantity: 44,
        countedQuantity: 44
      },
      {
        item: "SEAL-VR-45",
        shelf: "A1-L2",
        snapshotQuantity: 120,
        countedQuantity: 120
      },
      {
        item: "ENC-INC-2048",
        shelf: "A1-L3",
        snapshotQuantity: 6,
        countedQuantity: 6
      }
    ]
  },
  {
    key: "aug-cycle",
    status: "Posted",
    notes: "Cycle count — fastener & seal bins",
    postedOffset: -20,
    lines: [
      {
        item: "FST-M6-SS",
        shelf: "A1-L1",
        snapshotQuantity: 900,
        countedQuantity: 898
      },
      {
        item: "FST-M10-SS",
        shelf: "A1-L1",
        snapshotQuantity: 500,
        countedQuantity: 500
      },
      {
        item: "SEAL-VR-45",
        shelf: "A1-L2",
        snapshotQuantity: 120,
        countedQuantity: 122
      },
      {
        item: "NPL-SS-STD",
        shelf: "A1-L3",
        snapshotQuantity: 150,
        countedQuantity: 150
      },
      {
        item: "CN-BRG-GREASE",
        shelf: "A2-L2",
        snapshotQuantity: 12,
        countedQuantity: 12
      }
    ]
  }
];

// Only the Completed move changes stock, so it's dated after the posted count above.
export const STOCK_TRANSFERS: StockTransferSpec[] = [
  {
    key: "st-completed",
    status: "Completed",
    fromShelf: "A1-L1",
    toShelf: "A2-L2",
    dateOffset: -10,
    lines: [{ item: "FST-M6-SS", quantity: 60 }]
  },
  {
    key: "st-released",
    status: "Released",
    fromShelf: "A3-L2",
    toShelf: "A3-L1",
    dateOffset: -1,
    lines: [{ item: "MAT-AL6061-BAR", quantity: 40 }]
  },
  {
    key: "st-draft",
    status: "Draft",
    fromShelf: "A2-L2",
    toShelf: "A2-L1",
    dateOffset: 0,
    lines: [{ item: "CN-BRG-GREASE", quantity: 2 }]
  }
];

// HQ has no bins, so completed receipts land shelfless.
export const WAREHOUSE_TRANSFERS: WarehouseTransferSpec[] = [
  {
    key: "wt-completed",
    status: "Completed",
    fromLocation: "Plant",
    toLocation: "HQ",
    dateOffset: -12,
    lines: [{ item: "FST-M10-SS", quantity: 30, fromShelf: "A1-L1" }]
  },
  {
    key: "wt-toship",
    status: "To Ship",
    fromLocation: "Plant",
    toLocation: "HQ",
    dateOffset: 0,
    lines: [{ item: "MAT-VARNISH", quantity: 2, fromShelf: "A3-L3" }]
  },
  {
    key: "wt-draft",
    status: "Draft",
    fromLocation: "Plant",
    toLocation: "HQ",
    dateOffset: 2,
    lines: [{ item: "TRM-BLK-6P", quantity: 6, fromShelf: "A1-L2" }]
  }
];

export const motorInventory: InventoryData = {
  openingStock: OPENING_STOCK,
  onHandTracked: ON_HAND_TRACKED,
  kanbanItems: KANBAN_ITEMS,
  inventoryCounts: INVENTORY_COUNTS,
  shelfLives: SHELF_LIVES,
  stockTransfers: STOCK_TRANSFERS,
  warehouseTransfers: WAREHOUSE_TRANSFERS
};
