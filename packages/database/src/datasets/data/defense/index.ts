// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Dataset } from "../../types.ts";
import { defenseAccounting } from "./accounting.ts";
import { defenseChangeOrders } from "./change-orders.ts";
import { defenseFoundation } from "./foundation.ts";
import { defenseInventory } from "./inventory.ts";
import { defenseItems } from "./items.ts";
import { defenseOps } from "./ops.ts";
import { defensePlanning } from "./planning.ts";
import { defenseProduction } from "./production.ts";
import { defensePurchasing } from "./purchasing.ts";
import { defenseQuality } from "./quality.ts";
import { defenseSales } from "./sales.ts";
import { defenseWorkflows } from "./workflows.ts";

/**
 * Halberd Unmanned Systems — a defense sUAS maker whose hero product is the
 * ISR-4 Tactical Quadcopter, sold as a system kit to DoD program offices.
 */
export const defense: Dataset = {
  key: "defense",
  label: "Defense & Unmanned Systems",
  industryId: "defense_uas",
  foundation: defenseFoundation,
  items: defenseItems,
  inventory: defenseInventory,
  sales: defenseSales,
  purchasing: defensePurchasing,
  production: defenseProduction,
  quality: defenseQuality,
  changeOrders: defenseChangeOrders,
  accounting: defenseAccounting,
  ops: defenseOps,
  workflows: defenseWorkflows,
  planning: defensePlanning
};
