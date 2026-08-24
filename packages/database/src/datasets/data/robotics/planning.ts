import type {
  DemandOrderSpec,
  DemandProjectionSpec,
  PlanningData
} from "../../types.ts";

export const BUY_ITEM_IDS: string[] = [
  "MOT-AC-750W",
  "MOT-AC-200W",
  "GBX-HD-80",
  "GBX-HD-50",
  "ENC-ABS-19",
  "DRV-SRV-400"
];

export const MAKE_ITEM_IDS: string[] = [
  "ROB-2000",
  "ARM-BASE-001",
  "ARM-LINK-001",
  "ARM-WRIST-001",
  "CTRL-100"
];

// get_production_projections INNER JOINs demandProjection, so /x/production/
// projections shows only items that have a forecast. These three are Make,
// Inventory-tracked, active and already have an itemPlanning row at the Plant.
export const DEMAND_PROJECTIONS: DemandProjectionSpec[] = [
  { readableId: "ROB-2000", quantities: [2, 2, 3, 3, 4, 4, 5, 5] },
  { readableId: "CTRL-100", quantities: [6, 6, 8, 8, 10, 10, 12, 12] },
  { readableId: "ARM-WRIST-001", quantities: [3, 4, 4, 5, 6, 6, 8, 8] }
];

// Open sales order so MRP has real demandActual to plan against.
export const DEMAND_ORDER: DemandOrderSpec = {
  ref: "so:planning-seed",
  status: "To Ship",
  customer: "Lakeshore Automotive",
  currencyCode: "USD",
  shippingMethod: "UPS Ground",
  promisedDateOffset: 56,
  lines: [
    {
      item: "MOT-AC-750W",
      salesOrderLineType: "Part",
      saleQuantity: 8,
      unitPriceMultiplier: 1.5,
      unitOfMeasureCode: "EA",
      methodType: "Pull from Inventory",
      status: "Ordered",
      sortOrder: 1
    },
    {
      item: "GBX-HD-80",
      salesOrderLineType: "Part",
      saleQuantity: 4,
      unitPriceMultiplier: 1.5,
      unitOfMeasureCode: "EA",
      methodType: "Pull from Inventory",
      status: "Ordered",
      sortOrder: 2
    }
  ]
};

export const roboticsPlanning: PlanningData = {
  buyItemIds: BUY_ITEM_IDS,
  makeItemIds: MAKE_ITEM_IDS,
  demandProjections: DEMAND_PROJECTIONS,
  demandOrder: DEMAND_ORDER
};
