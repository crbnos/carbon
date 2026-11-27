// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { t, type ValueType } from "../definition/types";
import type { ActionInputLike } from "./actions";

/** An operation reads its entity: the generator gives it View on the page of the entity's table. */
export interface OperationDeclarationLike {
  label: string;
  entity: string;
  inputs: Record<string, ActionInputLike>;
  output: ValueType;
}

/** Every operation takes exactly the one record it works out a number for. */
const operation = (
  label: string,
  entity: string,
  output: ValueType
): OperationDeclarationLike => ({
  label,
  entity,
  inputs: {
    [entity]: { type: t.entity(entity), required: true, label: "record" }
  },
  output
});

// Read-only computations over things a property map cannot reach — stored
// totals live only on views, and counts span child tables.
export const WORKFLOW_OPERATIONS = {
  "purchaseOrder.total": operation("Total", "purchaseOrder", t.number),
  "purchaseOrder.lineCount": operation(
    "Number of lines",
    "purchaseOrder",
    t.number
  ),
  "salesOrder.total": operation("Total", "salesOrder", t.number),
  "salesOrder.lineCount": operation("Number of lines", "salesOrder", t.number),
  "quote.total": operation("Total", "quote", t.number),
  "receipt.lineCount": operation("Number of lines", "receipt", t.number),
  "shipment.lineCount": operation("Number of lines", "shipment", t.number),
  "job.totalScrapQuantity": operation("Total scrap quantity", "job", t.number),
  "job.scrapPercentage": operation("Scrap percentage", "job", t.number),
  "job.operationCount": operation("Number of operations", "job", t.number),
  "job.openOperationCount": operation(
    "Number of open operations",
    "job",
    t.number
  ),
  "job.earliestOperationStart": operation(
    "Earliest operation start",
    "job",
    t.date
  ),
  "job.latestOperationEnd": operation("Latest operation end", "job", t.date),
  "nonConformance.openTaskCount": operation(
    "Number of open tasks",
    "nonConformance",
    t.number
  ),
  "item.quantityOnHand": operation("Quantity on hand", "item", t.number)
} satisfies Record<string, OperationDeclarationLike>;
