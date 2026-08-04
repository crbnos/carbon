import type { RequiredPermission } from "../definition/catalog";
import { t, type ValueType } from "../definition/types";
import type { ActionInputLike } from "./actions";

export interface OperationDeclarationLike {
  label: string;
  entity: string;
  permission: RequiredPermission;
  inputs: Record<string, ActionInputLike>;
  output: ValueType;
}

/** Every operation takes exactly the one record it works out a number for. */
const operation = (
  label: string,
  entity: string,
  module: string,
  output: ValueType
): OperationDeclarationLike => ({
  label,
  entity,
  permission: { module, action: "view" },
  inputs: {
    [entity]: { type: t.entity(entity), required: true, label: "record" }
  },
  output
});

// Read-only computations over things a property map cannot reach — stored
// totals live only on views, and counts span child tables.
export const WORKFLOW_OPERATIONS = {
  "purchaseOrder.total": operation(
    "Total",
    "purchaseOrder",
    "purchasing",
    t.number
  ),
  "purchaseOrder.lineCount": operation(
    "Number of lines",
    "purchaseOrder",
    "purchasing",
    t.number
  ),
  "salesOrder.total": operation("Total", "salesOrder", "sales", t.number),
  "salesOrder.lineCount": operation(
    "Number of lines",
    "salesOrder",
    "sales",
    t.number
  ),
  "quote.total": operation("Total", "quote", "sales", t.number),
  "receipt.lineCount": operation(
    "Number of lines",
    "receipt",
    "inventory",
    t.number
  ),
  "shipment.lineCount": operation(
    "Number of lines",
    "shipment",
    "inventory",
    t.number
  ),
  "job.totalScrapQuantity": operation(
    "Total scrap quantity",
    "job",
    "production",
    t.number
  ),
  "job.scrapPercentage": operation(
    "Scrap percentage",
    "job",
    "production",
    t.number
  ),
  "job.operationCount": operation(
    "Number of operations",
    "job",
    "production",
    t.number
  ),
  "job.openOperationCount": operation(
    "Number of open operations",
    "job",
    "production",
    t.number
  ),
  "job.earliestOperationStart": operation(
    "Earliest operation start",
    "job",
    "production",
    t.date
  ),
  "job.latestOperationEnd": operation(
    "Latest operation end",
    "job",
    "production",
    t.date
  ),
  "nonConformance.openTaskCount": operation(
    "Number of open tasks",
    "nonConformance",
    "quality",
    t.number
  ),
  "item.quantityOnHand": operation(
    "Quantity on hand",
    "item",
    "parts",
    t.number
  )
} satisfies Record<string, OperationDeclarationLike>;
