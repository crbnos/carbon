import type {
  InventoryCountSpec,
  InventoryData,
  KanbanItemSpec,
  OpeningStockSpec,
  TrackedStockSpec
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
  { item: "MAT-AL6061-BIL", qty: 480, shelf: "A3-L1" },
  { item: "MAT-STEEL-SHT", qty: 220, shelf: "A3-L1" },
  { item: "MAT-CBL-16AWG", qty: 800, shelf: "A3-L2" },
  { item: "MAT-CONN-M23", qty: 60, shelf: "A1-L2" },
  { item: "MAT-SOLDER-PST", qty: 4, shelf: "ESD-Cage" },
  { item: "MAT-COAT-UV", qty: 3, shelf: "A1-L3" },
  { item: "CN-COVER-KIT", qty: 5, shelf: "A1-L3" },
  { item: "CN-GREASE-EP", qty: 6, shelf: "A1-L2" }
];

// Lots/serials that back the tracked slice of the opening stock above.
export const ON_HAND_TRACKED: TrackedStockSpec[] = [
  {
    item: "ENC-ABS-19",
    entities: [
      { readableId: "LOT-ENC-2607", quantity: 8 },
      { readableId: "LOT-ENC-2608", quantity: 4 }
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
      { readableId: "LOT-AL6061-2609", quantity: 180 }
    ]
  }
];

// Kanbans (auto-replenishment cards) for high-usage buy parts.
export const KANBAN_ITEMS: KanbanItemSpec[] = [
  { item: "FST-M8-SS", qty: 200, supplier: "Precision Fasteners Co" },
  { item: "FST-M5-SS", qty: 100, supplier: "Precision Fasteners Co" },
  { item: "PCB-BARE-4L", qty: 10, supplier: "Northgate Electronics" }
];

export const INVENTORY_COUNT: InventoryCountSpec = {
  status: "Draft",
  notes: "Quarterly physical count — Q3"
};

export const roboticsInventory: InventoryData = {
  openingStock: OPENING_STOCK,
  onHandTracked: ON_HAND_TRACKED,
  kanbanItems: KANBAN_ITEMS,
  inventoryCount: INVENTORY_COUNT
};
