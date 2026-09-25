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

// Opening inventory — realistic quantities for a smallsat shop.
// Parts that are bought (Buy replenishment) get stock; Make parts do not.
export const OPENING_STOCK: OpeningStockSpec[] = [
  { item: "BAT-LIION-48V", qty: 3, shelf: "A1-L2" },
  { item: "PCB-BARE-REV3", qty: 20, shelf: "A1-L1" },
  { item: "RW-010", qty: 4, shelf: "A2-L2" },
  { item: "ST-050", qty: 2, shelf: "A2-L3" },
  { item: "TXRX-SBAND", qty: 3, shelf: "A2-L2" },
  { item: "THR-HYDRA-1N", qty: 4, shelf: "A3-L1" },
  { item: "TANK-TI-4L", qty: 2, shelf: "A3-L1" },
  { item: "VLV-SOLENOID-LP", qty: 8, shelf: "A3-L2" },
  { item: "FST-M4-TI", qty: 500, shelf: "A1-L1" },
  { item: "FST-M6-A286", qty: 200, shelf: "A1-L1" },
  { item: "BRG-6201", qty: 24, shelf: "A1-L3" },
  { item: "MAT-AL7075-PLT", qty: 64, shelf: "A2-L1" },
  { item: "MAT-CF-LAM", qty: 10, shelf: "CleanRoom" },
  { item: "MAT-GAAS-CELL", qty: 256, shelf: "CleanRoom" },
  { item: "MAT-KAPTON", qty: 50, shelf: "A1-L3" },
  { item: "MAT-SYLGARD", qty: 5, shelf: "A2-L1" },
  { item: "MAT-CONFCOAT", qty: 12, shelf: "A2-L1" },
  { item: "CN-MLI-001", qty: 4, shelf: "CleanRoom" },
  { item: "CN-GREASE-001", qty: 3, shelf: "A1-L3" }
];

// Backs the tracked slice of the opening stock above.
export const ON_HAND_TRACKED: TrackedStockSpec[] = [
  {
    item: "BAT-LIION-48V",
    entities: [
      { readableId: "LOT-BAT-2607", quantity: 2 },
      { readableId: "LOT-BAT-2608", quantity: 1, expiresOffset: 30 },
      { readableId: "LOT-BAT-2609", quantity: 1, status: "On Hold" }
    ]
  },
  {
    item: "RW-010",
    entities: [
      { readableId: "RW010-SN-0051", quantity: 1 },
      { readableId: "RW010-SN-0052", quantity: 1 },
      { readableId: "RW010-SN-0053", quantity: 1 },
      { readableId: "RW010-SN-0054", quantity: 1 }
    ]
  },
  {
    item: "MAT-AL7075-PLT",
    entities: [
      { readableId: "LOT-AL7075-2608", quantity: 40 },
      { readableId: "LOT-AL7075-2609", quantity: 20 },
      { readableId: "LOT-AL7075-2610", quantity: 2, status: "Rejected" },
      {
        readableId: "LOT-AL7075-2604",
        quantity: 4,
        status: "Scrapped",
        scrap: {
          shelf: "A2-L1",
          reason: "Damaged",
          dateOffset: -34,
          comment: "Plates bent past flatness tolerance in a forklift drop"
        }
      }
    ]
  }
];

// LOT-BAT-2608 above expires in 30 days so the expiry chips show amber.
export const SHELF_LIVES: ShelfLifeSpec[] = [
  { item: "BAT-LIION-48V", days: 365 }
];

export const KANBAN_ITEMS: KanbanItemSpec[] = [
  { item: "FST-M4-TI", qty: 200, supplier: "SpaceGrade Fasteners" },
  { item: "FST-M6-A286", qty: 100, supplier: "SpaceGrade Fasteners" },
  { item: "PCB-BARE-REV3", qty: 10, supplier: "CelestialElex" },
  { item: "BUS-STR-001", qty: 2, replenishmentSystem: "Make" },
  {
    item: "MAT-KAPTON",
    qty: 10,
    replenishmentSystem: "Transfer",
    fromShelf: "A1-L3",
    toShelf: "CleanRoom"
  }
];

export const INVENTORY_COUNTS: InventoryCountSpec[] = [
  {
    // The first six opening-stock rows.
    key: "q3-draft",
    status: "Draft",
    notes: "Quarterly physical count — Q3",
    lines: [
      {
        item: "BAT-LIION-48V",
        shelf: "A1-L2",
        snapshotQuantity: 3,
        countedQuantity: 3
      },
      {
        item: "PCB-BARE-REV3",
        shelf: "A1-L1",
        snapshotQuantity: 20,
        countedQuantity: 20
      },
      {
        item: "RW-010",
        shelf: "A2-L2",
        snapshotQuantity: 4,
        countedQuantity: 4
      },
      {
        item: "ST-050",
        shelf: "A2-L3",
        snapshotQuantity: 2,
        countedQuantity: 2
      },
      {
        item: "TXRX-SBAND",
        shelf: "A2-L2",
        snapshotQuantity: 3,
        countedQuantity: 3
      },
      {
        item: "THR-HYDRA-1N",
        shelf: "A3-L1",
        snapshotQuantity: 4,
        countedQuantity: 4
      }
    ]
  },
  {
    key: "aug-cycle",
    status: "Posted",
    notes: "Cycle count — fastener & hardware bins",
    postedOffset: -20,
    lines: [
      {
        item: "FST-M4-TI",
        shelf: "A1-L1",
        snapshotQuantity: 500,
        countedQuantity: 498
      },
      {
        item: "FST-M6-A286",
        shelf: "A1-L1",
        snapshotQuantity: 200,
        countedQuantity: 200
      },
      {
        item: "BRG-6201",
        shelf: "A1-L3",
        snapshotQuantity: 24,
        countedQuantity: 26
      },
      {
        item: "MAT-KAPTON",
        shelf: "A1-L3",
        snapshotQuantity: 50,
        countedQuantity: 50
      },
      {
        item: "VLV-SOLENOID-LP",
        shelf: "A3-L2",
        snapshotQuantity: 8,
        countedQuantity: 8
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
    toShelf: "A1-L2",
    dateOffset: -10,
    lines: [{ item: "FST-M4-TI", quantity: 50 }]
  },
  {
    key: "st-released",
    status: "Released",
    fromShelf: "A1-L1",
    toShelf: "CleanRoom",
    dateOffset: -1,
    lines: [{ item: "FST-M6-A286", quantity: 20 }]
  },
  {
    key: "st-draft",
    status: "Draft",
    fromShelf: "A3-L2",
    toShelf: "A3-L3",
    dateOffset: 0,
    lines: [{ item: "VLV-SOLENOID-LP", quantity: 2 }]
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
    lines: [{ item: "FST-M6-A286", quantity: 25, fromShelf: "A1-L1" }]
  },
  {
    key: "wt-toship",
    status: "To Ship",
    fromLocation: "Plant",
    toLocation: "HQ",
    dateOffset: 0,
    lines: [{ item: "MAT-KAPTON", quantity: 5, fromShelf: "A1-L3" }]
  },
  {
    key: "wt-draft",
    status: "Draft",
    fromLocation: "Plant",
    toLocation: "HQ",
    dateOffset: 2,
    lines: [{ item: "BRG-6201", quantity: 4, fromShelf: "A1-L3" }]
  }
];

export const satelliteInventory: InventoryData = {
  openingStock: OPENING_STOCK,
  onHandTracked: ON_HAND_TRACKED,
  kanbanItems: KANBAN_ITEMS,
  inventoryCounts: INVENTORY_COUNTS,
  shelfLives: SHELF_LIVES,
  stockTransfers: STOCK_TRANSFERS,
  warehouseTransfers: WAREHOUSE_TRANSFERS
};
