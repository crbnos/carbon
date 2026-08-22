import type { Dataset } from "../../types.ts";
import { roboticsAccounting } from "./accounting.ts";
import { roboticsChangeOrders } from "./change-orders.ts";
import { roboticsFoundation } from "./foundation.ts";
import { roboticsInventory } from "./inventory.ts";
import { roboticsItems } from "./items.ts";
import { roboticsPlanning } from "./planning.ts";
import { roboticsProduction } from "./production.ts";
import { roboticsPurchasing } from "./purchasing.ts";
import { roboticsQuality } from "./quality.ts";
import { roboticsSales } from "./sales.ts";
import { roboticsWorkflows } from "./workflows.ts";

/**
 * Helix Robotics Inc. — a six-axis industrial robot arm OEM in Pittsburgh, PA.
 */
export const robotics: Dataset = {
  key: "robotics",
  label: "Robotics OEM",
  industryId: "robotics_oem",
  foundation: roboticsFoundation,
  items: roboticsItems,
  inventory: roboticsInventory,
  sales: roboticsSales,
  purchasing: roboticsPurchasing,
  production: roboticsProduction,
  quality: roboticsQuality,
  changeOrders: roboticsChangeOrders,
  accounting: roboticsAccounting,
  workflows: roboticsWorkflows,
  planning: roboticsPlanning
};
