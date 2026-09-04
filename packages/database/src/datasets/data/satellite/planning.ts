import type {
  DemandOrderSpec,
  DemandProjectionSpec,
  PlanningData
} from "../../types.ts";

export const BUY_ITEM_IDS: string[] = [
  "BAT-LIION-48V",
  "RW-010",
  "ST-050",
  "TXRX-SBAND",
  "THR-HYDRA-1N",
  "TANK-TI-4L"
];

export const MAKE_ITEM_IDS: string[] = [
  "SAT-1000",
  "BUS-STR-001",
  "EPS-001",
  "ADCS-001",
  "COMMS-001"
];

// get_production_projections INNER JOINs demandProjection, so /x/production/
// projections shows only items that have a forecast. These three are Make,
// Inventory-tracked, active and already have an itemPlanning row at the Plant.
export const DEMAND_PROJECTIONS: DemandProjectionSpec[] = [
  { readableId: "SAT-1000", quantities: [2, 2, 3, 3, 4, 4, 5, 5] },
  { readableId: "EPS-001", quantities: [6, 6, 8, 8, 10, 10, 12, 12] },
  { readableId: "ADCS-001", quantities: [3, 4, 4, 5, 6, 6, 8, 8] }
];

// Open sales order so MRP has real demandActual to plan against.
export const DEMAND_ORDER: DemandOrderSpec = {
  ref: "so:planning-seed",
  status: "To Ship",
  customer: "ORBSEC Defense",
  currencyCode: "USD",
  shippingMethod: "UPS Ground",
  promisedDateOffset: 56,
  lines: [
    {
      item: "BAT-LIION-48V",
      salesOrderLineType: "Part",
      saleQuantity: 8,
      unitPriceMultiplier: 1.5,
      unitOfMeasureCode: "EA",
      methodType: "Pull from Inventory",
      status: "Ordered",
      sortOrder: 1
    },
    {
      item: "RW-010",
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

export const satellitePlanning: PlanningData = {
  buyItemIds: BUY_ITEM_IDS,
  makeItemIds: MAKE_ITEM_IDS,
  demandProjections: DEMAND_PROJECTIONS,
  demandOrder: DEMAND_ORDER
};
