// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Dataset } from "../../types.ts";
import { motorAccounting } from "./accounting.ts";
import { motorChangeOrders } from "./change-orders.ts";
import { motorFoundation } from "./foundation.ts";
import { motorInventory } from "./inventory.ts";
import { motorItems } from "./items.ts";
import { motorOps } from "./ops.ts";
import { motorPlanning } from "./planning.ts";
import { motorProduction } from "./production.ts";
import { motorPurchasing } from "./purchasing.ts";
import { motorQuality } from "./quality.ts";
import { motorSales } from "./sales.ts";
import { motorWorkflows } from "./workflows.ts";

/**
 * Torque Dynamics LLC — a precision electric motor builder in Fort Wayne, IN.
 */
export const motor: Dataset = {
  key: "motor",
  label: "Motor Assembly",
  industryId: "automotive_precision",
  foundation: motorFoundation,
  items: motorItems,
  inventory: motorInventory,
  sales: motorSales,
  purchasing: motorPurchasing,
  production: motorProduction,
  quality: motorQuality,
  changeOrders: motorChangeOrders,
  accounting: motorAccounting,
  ops: motorOps,
  workflows: motorWorkflows,
  planning: motorPlanning
};
