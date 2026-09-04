import type {
  InventoryCountSpec,
  InventoryData,
  KanbanItemSpec,
  OpeningStockSpec,
  TrackedStockSpec
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
  { item: "MAT-AL6061-BAR", qty: 620, shelf: "Bar-Stock" },
  { item: "MAT-AL5052-SHT", qty: 380, shelf: "Bar-Stock" },
  { item: "MAT-SS304-BAR", qty: 260, shelf: "Bar-Stock" },
  { item: "MAT-SS316-PLT", qty: 210, shelf: "Bar-Stock" },
  { item: "MAT-4140-BAR", qty: 340, shelf: "Bar-Stock" },
  { item: "MAT-CRS-TUBE", qty: 180, shelf: "Bar-Stock" },
  { item: "CN-COOLANT-55", qty: 3, shelf: "B3-L1" },
  { item: "CN-DEBURR-MED", qty: 90, shelf: "B3-L1" }
];

// Lots/serials that back the tracked slice of the opening stock above.
export const ON_HAND_TRACKED: TrackedStockSpec[] = [
  {
    item: "BRG-DBL-6205",
    entities: [
      { readableId: "LOT-BRG-2611", quantity: 16 },
      { readableId: "LOT-BRG-2612", quantity: 8 }
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
      { readableId: "LOT-AL6061-2611", quantity: 220 }
    ]
  }
];

// Kanbans (auto-replenishment cards) for high-usage buy parts.
export const KANBAN_ITEMS: KanbanItemSpec[] = [
  { item: "HW-SHCS-M6", qty: 250, supplier: "Fastline Industrial Supply" },
  { item: "HW-SHCS-M10", qty: 150, supplier: "Fastline Industrial Supply" },
  { item: "SEAL-ORING-224", qty: 200, supplier: "Midway Bearing & Seal" }
];

export const INVENTORY_COUNT: InventoryCountSpec = {
  status: "Draft",
  notes: "Cycle count — hardware bins and bar stock racking"
};

export const precisionInventory: InventoryData = {
  openingStock: OPENING_STOCK,
  onHandTracked: ON_HAND_TRACKED,
  kanbanItems: KANBAN_ITEMS,
  inventoryCount: INVENTORY_COUNT
};
