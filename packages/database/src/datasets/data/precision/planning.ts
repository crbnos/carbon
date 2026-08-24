import type {
  DemandOrderSpec,
  DemandProjectionSpec,
  PlanningData
} from "../../types.ts";

export const BUY_ITEM_IDS: string[] = [
  "MAT-AL6061-BAR",
  "MAT-4140-BAR",
  "MAT-SS304-BAR",
  "BRG-DBL-6205",
  "HW-SHCS-M10",
  "CYL-HYD-40"
];

export const MAKE_ITEM_IDS: string[] = [
  "HMA-4000",
  "MCH-MANI-BLK",
  "MCH-HSG-PUMP",
  "FAB-BASE-WLD",
  "ASM-VALVE-SUB"
];

// get_production_projections INNER JOINs demandProjection, so /x/production/
// projections shows only items that have a forecast. These three are Make,
// Inventory-tracked, active and already have an itemPlanning row at the Plant.
export const DEMAND_PROJECTIONS: DemandProjectionSpec[] = [
  { readableId: "HMA-4000", quantities: [4, 4, 6, 6, 8, 8, 10, 10] },
  { readableId: "MCH-HSG-PUMP", quantities: [10, 10, 12, 12, 15, 15, 18, 18] },
  { readableId: "MCH-MANI-BLK", quantities: [12, 12, 14, 14, 16, 16, 20, 20] }
];

// Open sales order so MRP has real demandActual to plan against.
export const DEMAND_ORDER: DemandOrderSpec = {
  ref: "so:planning-seed",
  status: "To Ship",
  customer: "Cedar Valley Hydraulics",
  currencyCode: "USD",
  shippingMethod: "UPS Ground",
  promisedDateOffset: 56,
  lines: [
    {
      item: "CYL-HYD-40",
      salesOrderLineType: "Part",
      saleQuantity: 6,
      unitPriceMultiplier: 1.5,
      unitOfMeasureCode: "EA",
      methodType: "Pull from Inventory",
      status: "Ordered",
      sortOrder: 1
    },
    {
      item: "BRG-DBL-6205",
      salesOrderLineType: "Part",
      saleQuantity: 20,
      unitPriceMultiplier: 1.5,
      unitOfMeasureCode: "EA",
      methodType: "Pull from Inventory",
      status: "Ordered",
      sortOrder: 2
    }
  ]
};

export const precisionPlanning: PlanningData = {
  buyItemIds: BUY_ITEM_IDS,
  makeItemIds: MAKE_ITEM_IDS,
  demandProjections: DEMAND_PROJECTIONS,
  demandOrder: DEMAND_ORDER
};
