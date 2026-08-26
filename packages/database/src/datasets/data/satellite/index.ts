import type { Dataset } from "../../types.ts";
import { satelliteAccounting } from "./accounting.ts";
import { satelliteChangeOrders } from "./change-orders.ts";
import { satelliteFoundation } from "./foundation.ts";
import { satelliteInventory } from "./inventory.ts";
import { satelliteItems } from "./items.ts";
import { satellitePlanning } from "./planning.ts";
import { satelliteProduction } from "./production.ts";
import { satellitePurchasing } from "./purchasing.ts";
import { satelliteQuality } from "./quality.ts";
import { satelliteSales } from "./sales.ts";
import { satelliteWorkflows } from "./workflows.ts";

/**
 * Orbital Systems Inc. — a small-satellite manufacturer. The original dev-seed
 * story.
 */
export const satellite: Dataset = {
  key: "satellite",
  label: "Aerospace & Satellite",
  industryId: "aerospace_satellite",
  foundation: satelliteFoundation,
  items: satelliteItems,
  inventory: satelliteInventory,
  sales: satelliteSales,
  purchasing: satellitePurchasing,
  production: satelliteProduction,
  quality: satelliteQuality,
  changeOrders: satelliteChangeOrders,
  accounting: satelliteAccounting,
  workflows: satelliteWorkflows,
  planning: satellitePlanning
};
