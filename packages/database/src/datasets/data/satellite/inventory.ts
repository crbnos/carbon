import type {
  InventoryCountSpec,
  InventoryData,
  KanbanItemSpec,
  OpeningStockSpec,
  TrackedStockSpec
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
  { item: "MAT-AL7075-PLT", qty: 60, shelf: "A2-L1" },
  { item: "MAT-CF-LAM", qty: 10, shelf: "CleanRoom" },
  { item: "MAT-GAAS-CELL", qty: 256, shelf: "CleanRoom" },
  { item: "MAT-KAPTON", qty: 50, shelf: "A1-L3" },
  { item: "MAT-SYLGARD", qty: 5, shelf: "A2-L1" },
  { item: "MAT-CONFCOAT", qty: 12, shelf: "A2-L1" },
  { item: "CN-MLI-001", qty: 4, shelf: "CleanRoom" },
  { item: "CN-GREASE-001", qty: 2, shelf: "A1-L3" }
];

// Lots/serials that back the tracked slice of the opening stock above.
export const ON_HAND_TRACKED: TrackedStockSpec[] = [
  {
    item: "BAT-LIION-48V",
    entities: [
      { readableId: "LOT-BAT-2607", quantity: 2 },
      { readableId: "LOT-BAT-2608", quantity: 1 }
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
      { readableId: "LOT-AL7075-2609", quantity: 20 }
    ]
  }
];

// Kanbans (auto-replenishment cards) for high-usage buy parts.
export const KANBAN_ITEMS: KanbanItemSpec[] = [
  { item: "FST-M4-TI", qty: 200, supplier: "SpaceGrade Fasteners" },
  { item: "FST-M6-A286", qty: 100, supplier: "SpaceGrade Fasteners" },
  { item: "PCB-BARE-REV3", qty: 10, supplier: "CelestialElex" }
];

export const INVENTORY_COUNT: InventoryCountSpec = {
  status: "Draft",
  notes: "Quarterly physical count — Q3"
};

export const satelliteInventory: InventoryData = {
  openingStock: OPENING_STOCK,
  onHandTracked: ON_HAND_TRACKED,
  kanbanItems: KANBAN_ITEMS,
  inventoryCount: INVENTORY_COUNT
};
