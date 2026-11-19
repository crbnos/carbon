// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  BatchPropertySpec,
  ItemSpec,
  KanbanItemSpec,
  MakeMethodSpec,
  OpeningStockSpec,
  ProcessSpec,
  SerialSequenceSpec,
  ShelfSpec,
  SupplierLinkSpec,
  TrackedStockSpec,
  WarehouseSpec,
  WorkCenterSpec
} from "../../types.ts";

/**
 * The AJ-3 serial motor line: the one product of the `motor-line` walkthrough.
 */

// Every Batch-tracked item needs at least one batch property (validator rule).
export const AJ3_BATCH_PROPERTIES: BatchPropertySpec[] = [
  { item: "AJ3-BRG-F", label: "Heat lot", dataType: "text" },
  { item: "AJ3-BRG-R", label: "Heat lot", dataType: "text" }
];

// One process per station and step: the scheduler moves an unstarted operation
// to any work center that runs its process, and a line station is dedicated.
export const AJ3_PROCESSES: ProcessSpec[] = [
  { name: "AJ A1 Machining", factor: "Minutes/Piece", type: "Process" },
  { name: "AJ A2 Assembly", factor: "Minutes/Piece", type: "Assembly" },
  { name: "AJ A3 Test", factor: "Minutes/Piece", type: "Process" },
  { name: "AJ A4 Inspection", factor: "Minutes/Piece", type: "Inspection" },
  { name: "AJ A1 Welding", factor: "Minutes/Piece", type: "Process" },
  { name: "AJ A2 Machining", factor: "Minutes/Piece", type: "Process" },
  { name: "AJ A3 Assembly", factor: "Minutes/Piece", type: "Assembly" },
  { name: "AJ A4 Test", factor: "Minutes/Piece", type: "Process" },
  { name: "AJ B1 Assembly", factor: "Minutes/Piece", type: "Assembly" },
  { name: "AJ B2 Assembly", factor: "Minutes/Piece", type: "Assembly" },
  { name: "AJ B3 Assembly", factor: "Minutes/Piece", type: "Assembly" },
  { name: "AJ B4 Balancing", factor: "Minutes/Piece", type: "Process" },
  { name: "AJ M Assembly", factor: "Minutes/Piece", type: "Assembly" },
  { name: "AJ F1 Assembly", factor: "Minutes/Piece", type: "Assembly" },
  { name: "AJ F2 Assembly", factor: "Minutes/Piece", type: "Assembly" },
  { name: "AJ F3 Assembly", factor: "Minutes/Piece", type: "Assembly" },
  { name: "AJ F4 Assembly", factor: "Minutes/Piece", type: "Assembly" },
  { name: "AJ F5 Assembly", factor: "Minutes/Piece", type: "Assembly" },
  { name: "AJ F6 Test", factor: "Minutes/Piece", type: "Process" },
  { name: "AJ F6 Inspection", factor: "Minutes/Piece", type: "Inspection" }
];

// A1–A4 build the sub-assemblies, B1–B4 the rotor group, M merges the
// combustion chamber in and F1–F6 finish and test the engine.
const AJ3_STATIONS = [
  "A1",
  "A2",
  "A3",
  "A4",
  "B1",
  "B2",
  "B3",
  "B4",
  "M",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6"
];

export const AJ3_WORK_CENTERS: WorkCenterSpec[] = AJ3_STATIONS.map((name) => ({
  name,
  dept: "Assembly",
  ability: "Precision Assembly",
  laborRate: 60,
  machineRate: 0
}));

export const AJ3_WORK_CENTER_PROCESS_LINKS: Array<[string, string]> = [
  ["A1", "AJ A1 Machining"],
  ["A2", "AJ A2 Assembly"],
  ["A3", "AJ A3 Test"],
  ["A4", "AJ A4 Inspection"],
  ["A1", "AJ A1 Welding"],
  ["A2", "AJ A2 Machining"],
  ["A3", "AJ A3 Assembly"],
  ["A4", "AJ A4 Test"],
  ["B1", "AJ B1 Assembly"],
  ["B2", "AJ B2 Assembly"],
  ["B3", "AJ B3 Assembly"],
  ["B4", "AJ B4 Balancing"],
  ["M", "AJ M Assembly"],
  ["F1", "AJ F1 Assembly"],
  ["F2", "AJ F2 Assembly"],
  ["F3", "AJ F3 Assembly"],
  ["F4", "AJ F4 Assembly"],
  ["F5", "AJ F5 Assembly"],
  ["F6", "AJ F6 Test"],
  ["F6", "AJ F6 Inspection"]
];

export const AJ3_WORK_CENTER_SHIFTS: Array<[string, string]> = AJ3_STATIONS.map(
  (name): [string, string] => [name, "A Shift"]
);

export const AJ3_WAREHOUSES: WarehouseSpec[] = [
  { key: "WH1", name: "Warehouse 1", requiresBin: true }
];

// Station bins ("A1 Floor" … "F6 Floor") come from tier 01, one per work center.
export const AJ3_SHELVES: ShelfSpec[] = [
  { name: "WH1-Rack-A", warehouse: "WH1", storageType: "Rack" },
  {
    name: "WH1-A1",
    warehouse: "WH1",
    storageType: "Bin",
    parent: "WH1-Rack-A"
  },
  {
    name: "WH1-A2",
    warehouse: "WH1",
    storageType: "Bin",
    parent: "WH1-Rack-A"
  },
  {
    name: "WH1-A3",
    warehouse: "WH1",
    storageType: "Bin",
    parent: "WH1-Rack-A"
  },
  { name: "WH1-Rack-B", warehouse: "WH1", storageType: "Rack" },
  {
    name: "WH1-B1",
    warehouse: "WH1",
    storageType: "Bin",
    parent: "WH1-Rack-B"
  },
  {
    name: "WH1-B2",
    warehouse: "WH1",
    storageType: "Bin",
    parent: "WH1-Rack-B"
  },
  // Finished sub-assemblies: the chambers and injectors the engine line pulls.
  { name: "WH1-Rack-C", warehouse: "WH1", storageType: "Rack" },
  { name: "WH1-C1", warehouse: "WH1", storageType: "Bin", parent: "WH1-Rack-C" }
];

export const AJ3_MAKE_PARTS: ItemSpec[] = [
  {
    readableId: "AJ3-ENG",
    name: "AJ-3 Turbojet Engine",
    type: "Part",
    replenishment: "Make",
    trackingType: "Serial",
    unitOfMeasureCode: "EA",
    standardCost: 18500,
    unitSalePrice: 32000,
    thumbnail: "MTR-9000"
  },
  {
    readableId: "AJ3-CC",
    name: "AJ-3 Combustion Chamber",
    type: "Part",
    replenishment: "Make",
    trackingType: "Serial",
    unitOfMeasureCode: "EA",
    standardCost: 2400,
    unitSalePrice: 4200,
    thumbnail: "STA-9000"
  },
  {
    readableId: "AJ3-FIA",
    name: "AJ-3 Fuel Injector Assembly",
    type: "Part",
    replenishment: "Make",
    trackingType: "Serial",
    unitOfMeasureCode: "EA",
    standardCost: 640,
    unitSalePrice: 1100
  }
];

export const AJ3_BUY_PARTS: ItemSpec[] = [
  {
    readableId: "AJ3-BRG-F",
    name: "AJ-3 Front Shaft Bearing",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Batch",
    standardCost: 85,
    leadTime: 30,
    thumbnail: "BRG-6206-C3"
  },
  {
    readableId: "AJ3-BRG-R",
    name: "AJ-3 Rear Shaft Bearing",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Batch",
    standardCost: 95,
    leadTime: 30,
    thumbnail: "BRG-6308-C3"
  },
  {
    readableId: "AJ3-HSG-F",
    name: "AJ-3 Front Housing",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Inventory",
    standardCost: 1250,
    leadTime: 30,
    thumbnail: "HSG-9000"
  },
  {
    readableId: "AJ3-SHF",
    name: "AJ-3 Main Shaft",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Inventory",
    standardCost: 420,
    leadTime: 30,
    thumbnail: "SHF-9000"
  },
  {
    readableId: "AJ3-CMP-W",
    name: "AJ-3 Compressor Wheel",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Inventory",
    standardCost: 1800,
    leadTime: 30
  },
  {
    readableId: "AJ3-DIF",
    name: "AJ-3 Diffuser",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Inventory",
    standardCost: 650,
    leadTime: 30
  },
  {
    readableId: "AJ3-NGV",
    name: "AJ-3 Nozzle Guide Vane Ring",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Inventory",
    standardCost: 2100,
    leadTime: 30
  },
  {
    readableId: "AJ3-TRB-W",
    name: "AJ-3 Turbine Wheel",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Inventory",
    standardCost: 3200,
    leadTime: 30
  },
  {
    readableId: "AJ3-EXH",
    name: "AJ-3 Exhaust Cone",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Inventory",
    standardCost: 380,
    leadTime: 30
  },
  {
    readableId: "AJ3-FLN",
    name: "AJ-3 Fuel Line Kit",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Inventory",
    standardCost: 140,
    leadTime: 30
  },
  {
    readableId: "AJ3-LNR",
    name: "AJ-3 Combustion Liner Blank",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Inventory",
    standardCost: 520,
    leadTime: 30
  },
  {
    readableId: "AJ3-IGN",
    name: "AJ-3 Igniter Plug",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Inventory",
    standardCost: 75,
    leadTime: 30
  },
  {
    readableId: "AJ3-INJ-BDY",
    name: "AJ-3 Injector Body Blank",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Inventory",
    standardCost: 110,
    leadTime: 30
  },
  {
    readableId: "AJ3-NOZ",
    name: "AJ-3 Injector Nozzle Tip",
    type: "Part",
    replenishment: "Buy",
    trackingType: "Inventory",
    standardCost: 60,
    leadTime: 30
  }
];

// Each BOM line names the operation that consumes it, so the traveler and the
// line feeder know which station needs the part.
export const AJ3_METHODS: MakeMethodSpec[] = [
  {
    readableId: "AJ3-FIA",
    bom: [
      { component: "AJ3-INJ-BDY", quantity: 1, order: 1, operation: 1 },
      { component: "AJ3-NOZ", quantity: 1, order: 2, operation: 2 }
    ],
    bop: [
      {
        process: "AJ A1 Machining",
        workCenter: "A1",
        description: "Machine injector body",
        order: 1,
        laborTime: 0.5
      },
      {
        process: "AJ A2 Assembly",
        workCenter: "A2",
        description: "Fit nozzle tip",
        order: 2,
        laborTime: 0.5
      },
      {
        process: "AJ A3 Test",
        workCenter: "A3",
        description: "Flow test injector",
        order: 3,
        laborTime: 0.5
      },
      {
        process: "AJ A4 Inspection",
        workCenter: "A4",
        description: "Inspect injector",
        order: 4,
        laborTime: 0.25
      }
    ]
  },
  {
    readableId: "AJ3-CC",
    bom: [
      { component: "AJ3-LNR", quantity: 1, order: 1, operation: 1 },
      // Pull from Inventory: Make to Order would nest an injector sub-job.
      {
        component: "AJ3-FIA",
        quantity: 1,
        order: 2,
        operation: 3,
        methodType: "Pull from Inventory"
      },
      { component: "AJ3-IGN", quantity: 1, order: 3, operation: 3 }
    ],
    bop: [
      {
        process: "AJ A1 Welding",
        workCenter: "A1",
        description: "Weld combustion liner",
        order: 1,
        laborTime: 0.75
      },
      {
        process: "AJ A2 Machining",
        workCenter: "A2",
        description: "Drill liner cooling holes",
        order: 2,
        laborTime: 0.5
      },
      {
        process: "AJ A3 Assembly",
        workCenter: "A3",
        description: "Install fuel injector and igniter",
        order: 3,
        laborTime: 0.5
      },
      {
        process: "AJ A4 Test",
        workCenter: "A4",
        description: "Pressure test chamber",
        order: 4,
        laborTime: 0.5
      },
      {
        process: "AJ A4 Inspection",
        workCenter: "A4",
        description: "Inspect chamber",
        order: 5,
        laborTime: 0.25
      }
    ]
  },
  {
    readableId: "AJ3-ENG",
    bom: [
      { component: "AJ3-HSG-F", quantity: 1, order: 1, operation: 1 },
      { component: "AJ3-SHF", quantity: 1, order: 2, operation: 2 },
      { component: "AJ3-BRG-F", quantity: 1, order: 3, operation: 2 },
      { component: "AJ3-BRG-R", quantity: 1, order: 4, operation: 2 },
      { component: "AJ3-CMP-W", quantity: 1, order: 5, operation: 3 },
      { component: "AJ3-DIF", quantity: 1, order: 6, operation: 3 },
      // Pull from Inventory: Make to Order would nest a chamber sub-job.
      {
        component: "AJ3-CC",
        quantity: 1,
        order: 7,
        operation: 5,
        methodType: "Pull from Inventory"
      },
      { component: "AJ3-NGV", quantity: 1, order: 8, operation: 6 },
      { component: "AJ3-TRB-W", quantity: 1, order: 9, operation: 7 },
      { component: "AJ3-EXH", quantity: 1, order: 10, operation: 8 },
      { component: "AJ3-FLN", quantity: 1, order: 11, operation: 9 }
    ],
    bop: [
      {
        process: "AJ B1 Assembly",
        workCenter: "B1",
        description: "Prepare front housing",
        order: 1,
        laborTime: 0.5
      },
      {
        process: "AJ B2 Assembly",
        workCenter: "B2",
        description: "Press bearings onto main shaft",
        order: 2,
        laborTime: 0.5
      },
      {
        process: "AJ B3 Assembly",
        workCenter: "B3",
        description: "Fit compressor wheel and diffuser",
        order: 3,
        laborTime: 0.5
      },
      {
        process: "AJ B4 Balancing",
        workCenter: "B4",
        description: "Balance rotor group",
        order: 4,
        machineTime: 0.5,
        laborTime: 0.75
      },
      {
        process: "AJ M Assembly",
        workCenter: "M",
        description: "Merge: install combustion chamber",
        order: 5,
        laborTime: 0.75
      },
      {
        process: "AJ F1 Assembly",
        workCenter: "F1",
        description: "Fit nozzle guide vane ring",
        order: 6,
        laborTime: 0.5
      },
      {
        process: "AJ F2 Assembly",
        workCenter: "F2",
        description: "Fit turbine wheel",
        order: 7,
        laborTime: 0.5
      },
      {
        process: "AJ F3 Assembly",
        workCenter: "F3",
        description: "Fit exhaust cone",
        order: 8,
        laborTime: 0.5
      },
      {
        process: "AJ F4 Assembly",
        workCenter: "F4",
        description: "Route fuel lines",
        order: 9,
        laborTime: 0.5
      },
      {
        process: "AJ F5 Assembly",
        workCenter: "F5",
        description: "Connect igniter and sensor harness",
        order: 10,
        laborTime: 0.5
      },
      {
        process: "AJ F6 Test",
        workCenter: "F6",
        description: "Engine run test",
        order: 11,
        laborTime: 1.5
      },
      {
        process: "AJ F6 Inspection",
        workCenter: "F6",
        description: "Final inspection",
        order: 12,
        laborTime: 0.5
      }
    ]
  }
];

export const AJ3_SUPPLIER_PARTS: SupplierLinkSpec[] = [
  {
    supplier: "Summit Bearing Supply",
    item: "AJ3-BRG-F",
    price: 85,
    leadTime: 21
  },
  {
    supplier: "Summit Bearing Supply",
    item: "AJ3-BRG-R",
    price: 95,
    leadTime: 21
  },
  {
    supplier: "Maumee Contract Machining",
    item: "AJ3-HSG-F",
    price: 1250,
    leadTime: 30
  },
  {
    supplier: "Maumee Contract Machining",
    item: "AJ3-SHF",
    price: 420,
    leadTime: 30
  },
  {
    supplier: "Maumee Contract Machining",
    item: "AJ3-CMP-W",
    price: 1800,
    leadTime: 30
  },
  {
    supplier: "Maumee Contract Machining",
    item: "AJ3-DIF",
    price: 650,
    leadTime: 30
  },
  {
    supplier: "Maumee Contract Machining",
    item: "AJ3-NGV",
    price: 2100,
    leadTime: 30
  },
  {
    supplier: "Maumee Contract Machining",
    item: "AJ3-TRB-W",
    price: 3200,
    leadTime: 30
  },
  {
    supplier: "Maumee Contract Machining",
    item: "AJ3-EXH",
    price: 380,
    leadTime: 30
  },
  {
    supplier: "Maumee Contract Machining",
    item: "AJ3-FLN",
    price: 140,
    leadTime: 30
  },
  {
    supplier: "Maumee Contract Machining",
    item: "AJ3-LNR",
    price: 520,
    leadTime: 30
  },
  {
    supplier: "Maumee Contract Machining",
    item: "AJ3-IGN",
    price: 75,
    leadTime: 30
  },
  {
    supplier: "Maumee Contract Machining",
    item: "AJ3-INJ-BDY",
    price: 110,
    leadTime: 30
  },
  {
    supplier: "Maumee Contract Machining",
    item: "AJ3-NOZ",
    price: 60,
    leadTime: 30
  }
];

// Stock sits in the warehouse only. Empty station bins give the line feeder
// screen its shortages.
export const AJ3_OPENING_STOCK: OpeningStockSpec[] = [
  { item: "AJ3-BRG-F", qty: 20, shelf: "WH1-A1" },
  { item: "AJ3-BRG-R", qty: 20, shelf: "WH1-A1" },
  { item: "AJ3-HSG-F", qty: 20, shelf: "WH1-A2" },
  { item: "AJ3-SHF", qty: 20, shelf: "WH1-A2" },
  { item: "AJ3-CMP-W", qty: 20, shelf: "WH1-A2" },
  { item: "AJ3-DIF", qty: 20, shelf: "WH1-A2" },
  { item: "AJ3-NGV", qty: 20, shelf: "WH1-A3" },
  { item: "AJ3-TRB-W", qty: 20, shelf: "WH1-A3" },
  { item: "AJ3-EXH", qty: 20, shelf: "WH1-A3" },
  { item: "AJ3-FLN", qty: 20, shelf: "WH1-B1" },
  { item: "AJ3-IGN", qty: 20, shelf: "WH1-B1" },
  { item: "AJ3-LNR", qty: 20, shelf: "WH1-B1" },
  { item: "AJ3-INJ-BDY", qty: 20, shelf: "WH1-B2" },
  { item: "AJ3-NOZ", qty: 20, shelf: "WH1-B2" },
  { item: "AJ3-CC", qty: 3, shelf: "WH1-C1" },
  { item: "AJ3-FIA", qty: 3, shelf: "WH1-C1" }
];

export const AJ3_ON_HAND_TRACKED: TrackedStockSpec[] = [
  {
    item: "AJ3-BRG-F",
    shelf: "WH1-A1",
    entities: [
      { readableId: "LOT-AJ3BF-01", quantity: 12 },
      { readableId: "LOT-AJ3BF-02", quantity: 8 }
    ]
  },
  {
    item: "AJ3-BRG-R",
    shelf: "WH1-A1",
    entities: [
      { readableId: "LOT-AJ3BR-01", quantity: 12 },
      { readableId: "LOT-AJ3BR-02", quantity: 8 }
    ]
  },
  // One serial per unit, so the engine line runs without building a chamber
  // or an injector first.
  {
    item: "AJ3-CC",
    shelf: "WH1-C1",
    entities: [
      { readableId: "AJ3C-0001", quantity: 1 },
      { readableId: "AJ3C-0002", quantity: 1 },
      { readableId: "AJ3C-0003", quantity: 1 }
    ]
  },
  {
    item: "AJ3-FIA",
    shelf: "WH1-C1",
    entities: [
      { readableId: "AJ3I-0001", quantity: 1 },
      { readableId: "AJ3I-0002", quantity: 1 },
      { readableId: "AJ3I-0003", quantity: 1 }
    ]
  }
];

export const AJ3_KANBAN_ITEMS: KanbanItemSpec[] = [
  {
    item: "AJ3-IGN",
    qty: 4,
    replenishmentSystem: "Transfer",
    fromShelf: "WH1-B1",
    toShelf: "wc:A3",
    replenishmentLevel: 2
  },
  {
    item: "AJ3-NOZ",
    qty: 4,
    replenishmentSystem: "Transfer",
    fromShelf: "WH1-B2",
    toShelf: "wc:A2",
    replenishmentLevel: 2
  },
  {
    item: "AJ3-FLN",
    qty: 4,
    replenishmentSystem: "Transfer",
    fromShelf: "WH1-B1",
    toShelf: "wc:F4",
    replenishmentLevel: 2
  }
];

// `next` is the last counter issued. The chamber and injector sequences cover
// the serials on the shelf; the first engine job takes AJ3E-0001.
export const AJ3_SERIAL_SEQUENCES: SerialSequenceSpec[] = [
  {
    item: "AJ3-ENG",
    prefix: "AJ3E-",
    size: 4,
    next: 0,
    serialNumberTiming: "jobCreation",
    printLabelOnCompletion: true
  },
  {
    item: "AJ3-CC",
    prefix: "AJ3C-",
    size: 4,
    next: 3,
    serialNumberTiming: "jobCreation"
  },
  {
    item: "AJ3-FIA",
    prefix: "AJ3I-",
    size: 4,
    next: 3,
    serialNumberTiming: "jobCreation"
  }
];
