import type {
  InventoryCountSpec,
  InventoryData,
  KanbanItemSpec,
  OpeningStockSpec,
  TrackedStockSpec
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
  { item: "MAT-LAM-M19", qty: 2400, shelf: "A3-L1" },
  { item: "MAT-CU-18AWG", qty: 640, shelf: "Winding-Crib" },
  { item: "MAT-INS-NOMEX", qty: 85, shelf: "Winding-Crib" },
  { item: "MAT-VARNISH", qty: 22, shelf: "A3-L3" },
  { item: "MAT-AL6061-BAR", qty: 720, shelf: "A3-L2" },
  { item: "MAT-STL-4140", qty: 540, shelf: "A3-L2" },
  { item: "CN-EPOXY-MAG", qty: 4, shelf: "A1-L3" },
  { item: "CN-BRG-GREASE", qty: 12, shelf: "A2-L2" }
];

// Lots/serials that back the tracked slice of the opening stock above; each
// group's quantities add up to that item's opening quantity.
export const ON_HAND_TRACKED: TrackedStockSpec[] = [
  {
    item: "MAG-NDFB-45",
    entities: [
      { readableId: "LOT-MAG45-2607", quantity: 300 },
      { readableId: "LOT-MAG45-2608", quantity: 180 }
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
      { readableId: "LOT-M19-2607", quantity: 1000 }
    ]
  },
  {
    item: "MAT-CU-18AWG",
    entities: [
      { readableId: "LOT-CU18-2608", quantity: 400 },
      { readableId: "LOT-CU18-2609", quantity: 240 }
    ]
  }
];

// Kanbans (auto-replenishment cards) for high-usage buy parts.
export const KANBAN_ITEMS: KanbanItemSpec[] = [
  { item: "FST-M6-SS", qty: 300, supplier: "Ironwood Fasteners" },
  { item: "FST-M10-SS", qty: 150, supplier: "Ironwood Fasteners" },
  { item: "SEAL-VR-45", qty: 40, supplier: "Summit Bearing Supply" }
];

export const INVENTORY_COUNT: InventoryCountSpec = {
  status: "Draft",
  notes: "Quarterly physical count — magnet vault and winding crib"
};

export const motorInventory: InventoryData = {
  openingStock: OPENING_STOCK,
  onHandTracked: ON_HAND_TRACKED,
  kanbanItems: KANBAN_ITEMS,
  inventoryCount: INVENTORY_COUNT
};
