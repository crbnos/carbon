import type {
  DemandOrderSpec,
  DemandProjectionSpec,
  PlanningData
} from "../../types.ts";

export const BUY_ITEM_IDS: string[] = [
  "MAG-NDFB-45",
  "MAG-NDFB-38",
  "BRG-6308-C3",
  "BRG-6206-C3",
  "ENC-INC-2048",
  "FAN-AX-160"
];

export const MAKE_ITEM_IDS: string[] = [
  "MTR-9000",
  "MTR-4500",
  "STA-9000",
  "ROT-9000",
  "HSG-9000"
];

// get_production_projections INNER JOINs demandProjection, so /x/production/
// projections shows only items that have a forecast. These three are Make,
// active and already have an itemPlanning row at the Plant.
export const DEMAND_PROJECTIONS: DemandProjectionSpec[] = [
  { readableId: "MTR-9000", quantities: [8, 8, 10, 10, 12, 12, 15, 15] },
  { readableId: "MTR-4500", quantities: [12, 12, 16, 16, 20, 20, 24, 24] },
  { readableId: "STA-9000", quantities: [10, 10, 12, 12, 14, 14, 18, 18] }
];

// Open sales order so MRP has real demandActual to plan against.
export const DEMAND_ORDER: DemandOrderSpec = {
  ref: "so:planning-seed",
  status: "To Ship",
  customer: "Ridgeline Drive Systems",
  currencyCode: "USD",
  shippingMethod: "UPS Ground",
  promisedDateOffset: 56,
  lines: [
    {
      item: "MAG-NDFB-45",
      salesOrderLineType: "Part",
      saleQuantity: 96,
      unitPriceMultiplier: 1.5,
      unitOfMeasureCode: "EA",
      methodType: "Pull from Inventory",
      status: "Ordered",
      sortOrder: 1
    },
    {
      item: "BRG-6308-C3",
      salesOrderLineType: "Part",
      saleQuantity: 24,
      unitPriceMultiplier: 1.5,
      unitOfMeasureCode: "EA",
      methodType: "Pull from Inventory",
      status: "Ordered",
      sortOrder: 2
    }
  ]
};

export const motorPlanning: PlanningData = {
  buyItemIds: BUY_ITEM_IDS,
  makeItemIds: MAKE_ITEM_IDS,
  demandProjections: DEMAND_PROJECTIONS,
  demandOrder: DEMAND_ORDER
};
