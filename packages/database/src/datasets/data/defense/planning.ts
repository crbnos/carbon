// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  DemandOrderSpec,
  DemandProjectionSpec,
  HqPlanningSpec,
  PlanningData
} from "../../types.ts";

export const BUY_ITEM_IDS: string[] = [
  "BAT-SMART-11AH",
  "ESC-80A-NDAA",
  "GMB-EOIR-640",
  "RDO-MESH-2X2",
  "PRP-2270-CF",
  "ARM-CF-30"
];

export const MAKE_ITEM_IDS: string[] = [
  "ISR4-AV",
  "AFR-100",
  "BAT-700",
  "AVN-500",
  "COM-800"
];

// get_production_projections INNER JOINs demandProjection, so /x/production/
// projections shows only items that have a forecast. These three are Make,
// Inventory-tracked, active and already have an itemPlanning row at the Plant.
export const DEMAND_PROJECTIONS: DemandProjectionSpec[] = [
  { readableId: "ISR4-AV", quantities: [2, 2, 3, 3, 4, 4, 5, 5] },
  { readableId: "BAT-700", quantities: [6, 6, 8, 8, 10, 10, 12, 12] },
  { readableId: "AVN-500", quantities: [3, 4, 4, 5, 6, 6, 8, 8] }
];

// Open sales order so MRP has real demandActual to plan against.
export const DEMAND_ORDER: DemandOrderSpec = {
  ref: "so:planning-seed",
  status: "To Ship",
  customer: "Army Small UAS Program Office",
  currencyCode: "USD",
  shippingMethod: "UPS Ground",
  promisedDateOffset: 56,
  lines: [
    {
      item: "BAT-SMART-11AH",
      salesOrderLineType: "Part",
      saleQuantity: 8,
      unitPriceMultiplier: 1.5,
      unitOfMeasureCode: "EA",
      methodType: "Pull from Inventory",
      status: "Ordered",
      sortOrder: 1
    },
    {
      item: "ESC-80A-NDAA",
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

export const HQ_PLANNING: HqPlanningSpec = {
  reorderItemIds: ["BAT-700", "BAT-SMART-11AH"],
  demandProjections: [{ readableId: "BAT-700", quantities: [1, 1, 2, 2] }]
};

export const defensePlanning: PlanningData = {
  buyItemIds: BUY_ITEM_IDS,
  makeItemIds: MAKE_ITEM_IDS,
  demandProjections: DEMAND_PROJECTIONS,
  demandOrder: DEMAND_ORDER,
  hq: HQ_PLANNING
};
