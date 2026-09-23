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

// Opening inventory — realistic quantities for a robot-arm OEM.
// Parts that are bought (Buy replenishment) get stock; Make parts do not.
// Every `shelf` must match a ShelfSpec name in foundation.ts or the row is lost.
export const OPENING_STOCK: OpeningStockSpec[] = [
  { item: "MOT-AC-750W", qty: 4, shelf: "ESD-Cage" },
  { item: "MOT-AC-200W", qty: 9, shelf: "A2-L2" },
  { item: "GBX-HD-80", qty: 5, shelf: "A2-L1" },
  { item: "GBX-HD-50", qty: 8, shelf: "A2-L1" },
  { item: "ENC-ABS-19", qty: 12, shelf: "ESD-Cage" },
  { item: "DRV-SRV-400", qty: 18, shelf: "ESD-Cage" },
  { item: "PCB-BARE-4L", qty: 40, shelf: "ESD-Cage" },
  { item: "SNS-FT-6AX", qty: 3, shelf: "ESD-Cage" },
  { item: "BRG-CRB-100", qty: 16, shelf: "A2-L3" },
  { item: "FST-M8-SS", qty: 600, shelf: "A1-L1" },
  { item: "FST-M5-SS", qty: 400, shelf: "A1-L1" },
  { item: "MAT-AL6061-BIL", qty: 485, shelf: "A3-L1" },
  { item: "MAT-STEEL-SHT", qty: 220, shelf: "A3-L1" },
  { item: "MAT-CBL-16AWG", qty: 800, shelf: "A3-L2" },
  { item: "MAT-CONN-M23", qty: 60, shelf: "A1-L2" },
  { item: "MAT-SOLDER-PST", qty: 4, shelf: "ESD-Cage" },
  { item: "MAT-COAT-UV", qty: 3, shelf: "A1-L3" },
  { item: "CN-COVER-KIT", qty: 5, shelf: "A1-L3" },
  { item: "CN-GREASE-EP", qty: 6, shelf: "A1-L2" }
];

// Lots/serials that back the tracked slice of the opening stock above, plus
// the quality states a real stockroom carries: an encoder lot on hold pending
// paperwork, a billet lot rejected at receiving, and an expiry-dated encoder
// lot (paired with the itemShelfLife spec below).
export const ON_HAND_TRACKED: TrackedStockSpec[] = [
  {
    item: "ENC-ABS-19",
    entities: [
      { readableId: "LOT-ENC-2607", quantity: 8 },
      { readableId: "LOT-ENC-2608", quantity: 4, expiresOffset: 30 },
      // Awaiting the vendor's factory calibration certificate before release.
      { readableId: "LOT-ENC-2609", quantity: 2, status: "On Hold" }
    ]
  },
  {
    item: "MOT-AC-750W",
    entities: [
      { readableId: "MOT750-SN-0051", quantity: 1 },
      { readableId: "MOT750-SN-0052", quantity: 1 },
      { readableId: "MOT750-SN-0053", quantity: 1 },
      { readableId: "MOT750-SN-0054", quantity: 1 }
    ]
  },
  {
    item: "MAT-AL6061-BIL",
    entities: [
      { readableId: "LOT-AL6061-2608", quantity: 300 },
      { readableId: "LOT-AL6061-2609", quantity: 180 },
      // Failed the incoming mill-cert hardness check — quarantined for MRB.
      { readableId: "LOT-AL6061-2610", quantity: 3, status: "Rejected" },
      // Saw-cut billets left out in the wash bay — corroded, scrapped.
      {
        readableId: "LOT-AL6061-2604",
        quantity: 5,
        status: "Scrapped",
        scrap: {
          shelf: "A3-L1",
          reason: "Damaged",
          dateOffset: -38,
          comment:
            "Billets corroded after sitting in the wash bay over a weekend"
        }
      }
    ]
  }
];

// Absolute encoders carry a 1-year factory calibration certificate, with
// LOT-ENC-2608 above expiring in 30 days so the expiry chips have something
// amber to show.
export const SHELF_LIVES: ShelfLifeSpec[] = [{ item: "ENC-ABS-19", days: 365 }];

// Kanbans (auto-replenishment cards): Buy cards for high-usage buy parts, a
// Make card for the machined arm base, and a Transfer card feeding the
// harness bench's point-of-use bin.
export const KANBAN_ITEMS: KanbanItemSpec[] = [
  { item: "FST-M8-SS", qty: 200, supplier: "Precision Fasteners Co" },
  { item: "FST-M5-SS", qty: 100, supplier: "Precision Fasteners Co" },
  { item: "PCB-BARE-4L", qty: 10, supplier: "Northgate Electronics" },
  { item: "ARM-BASE-001", qty: 2, replenishmentSystem: "Make" },
  {
    item: "MAT-CBL-16AWG",
    qty: 100,
    replenishmentSystem: "Transfer",
    fromShelf: "A3-L2",
    toShelf: "A1-L2"
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
        item: "MOT-AC-750W",
        shelf: "ESD-Cage",
        snapshotQuantity: 4,
        countedQuantity: 4
      },
      {
        item: "MOT-AC-200W",
        shelf: "A2-L2",
        snapshotQuantity: 9,
        countedQuantity: 9
      },
      {
        item: "GBX-HD-80",
        shelf: "A2-L1",
        snapshotQuantity: 5,
        countedQuantity: 5
      },
      {
        item: "GBX-HD-50",
        shelf: "A2-L1",
        snapshotQuantity: 8,
        countedQuantity: 8
      },
      {
        item: "ENC-ABS-19",
        shelf: "ESD-Cage",
        snapshotQuantity: 12,
        countedQuantity: 12
      },
      {
        item: "DRV-SRV-400",
        shelf: "ESD-Cage",
        snapshotQuantity: 18,
        countedQuantity: 18
      }
    ]
  },
  {
    // August cycle count over the fastener aisle: two small variances (a
    // missing bag of M8s, two bearings found loose behind the bin).
    key: "aug-cycle",
    status: "Posted",
    notes: "Cycle count — fastener & hardware bins",
    postedOffset: -20,
    lines: [
      {
        item: "FST-M8-SS",
        shelf: "A1-L1",
        snapshotQuantity: 600,
        countedQuantity: 597
      },
      {
        item: "FST-M5-SS",
        shelf: "A1-L1",
        snapshotQuantity: 400,
        countedQuantity: 400
      },
      {
        item: "BRG-CRB-100",
        shelf: "A2-L3",
        snapshotQuantity: 16,
        countedQuantity: 18
      },
      {
        item: "MAT-CONN-M23",
        shelf: "A1-L2",
        snapshotQuantity: 60,
        countedQuantity: 60
      },
      {
        item: "CN-GREASE-EP",
        shelf: "A1-L2",
        snapshotQuantity: 6,
        countedQuantity: 6
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
    fromShelf: "A1-L1",
    toShelf: "A1-L2",
    dateOffset: -10,
    lines: [{ item: "FST-M8-SS", quantity: 50 }]
  },
  {
    key: "st-released",
    status: "Released",
    fromShelf: "A1-L2",
    toShelf: "A3-L2",
    dateOffset: -1,
    lines: [{ item: "MAT-CONN-M23", quantity: 12 }]
  },
  {
    key: "st-draft",
    status: "Draft",
    fromShelf: "A3-L1",
    toShelf: "A3-L3",
    dateOffset: 0,
    lines: [{ item: "MAT-STEEL-SHT", quantity: 20 }]
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
    lines: [{ item: "FST-M5-SS", quantity: 25, fromShelf: "A1-L1" }]
  },
  {
    key: "wt-toship",
    status: "To Ship",
    fromLocation: "Plant",
    toLocation: "HQ",
    dateOffset: 0,
    lines: [{ item: "CN-COVER-KIT", quantity: 2, fromShelf: "A1-L3" }]
  },
  {
    key: "wt-draft",
    status: "Draft",
    fromLocation: "Plant",
    toLocation: "HQ",
    dateOffset: 2,
    lines: [{ item: "BRG-CRB-100", quantity: 4, fromShelf: "A2-L3" }]
  }
];

export const roboticsInventory: InventoryData = {
  openingStock: OPENING_STOCK,
  onHandTracked: ON_HAND_TRACKED,
  kanbanItems: KANBAN_ITEMS,
  inventoryCounts: INVENTORY_COUNTS,
  shelfLives: SHELF_LIVES,
  stockTransfers: STOCK_TRANSFERS,
  warehouseTransfers: WAREHOUSE_TRANSFERS
};
