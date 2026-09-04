import type { Dataset } from "../../types.ts";
import { precisionAccounting } from "./accounting.ts";
import { precisionChangeOrders } from "./change-orders.ts";
import { precisionFoundation } from "./foundation.ts";
import { precisionInventory } from "./inventory.ts";
import { precisionItems } from "./items.ts";
import { precisionPlanning } from "./planning.ts";
import { precisionProduction } from "./production.ts";
import { precisionPurchasing } from "./purchasing.ts";
import { precisionQuality } from "./quality.ts";
import { precisionSales } from "./sales.ts";
import { precisionWorkflows } from "./workflows.ts";

/**
 * Meridian Precision Works — a contract machine shop in Rockford, IL running
 * CNC milling, turning and sheet-metal fabrication to customer-supplied prints,
 * with outside processing as a first-class routing step.
 */
export const precision: Dataset = {
  key: "precision",
  label: "Precision Manufacturing",
  industryId: "precision_manufacturing",
  foundation: precisionFoundation,
  items: precisionItems,
  inventory: precisionInventory,
  sales: precisionSales,
  purchasing: precisionPurchasing,
  production: precisionProduction,
  quality: precisionQuality,
  changeOrders: precisionChangeOrders,
  accounting: precisionAccounting,
  workflows: precisionWorkflows,
  planning: precisionPlanning
};
