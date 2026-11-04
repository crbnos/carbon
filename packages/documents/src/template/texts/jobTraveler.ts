// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { FOOTER_TEXTS } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const jobTravelerTexts = {
  document: [
    { key: "title", kind: "heading", default: "Job Traveler" },
    // Printed before the sales order id under the title.
    { key: "salesOrderPrefix", kind: "text", default: "SO# " },
    // The materials table is not a block, so its columns live here.
    { key: "materialsItem", kind: "column", default: "Item" },
    { key: "materialsDescription", kind: "text", default: "Description" },
    { key: "materialsQuantity", kind: "column", default: "Quantity" },
    ...FOOTER_TEXTS
  ],
  jobDetails: [
    { key: "jobId", kind: "field", default: "Job ID:" },
    { key: "partId", kind: "field", default: "Part ID:" },
    { key: "service", kind: "field", default: "Service:" },
    { key: "methodRevision", kind: "field", default: "Method Revision:" },
    { key: "tracking", kind: "field", default: "Tracking:" },
    // Printed after the tracking type: "Batch Number: B-1".
    { key: "number", kind: "text", default: " Number:" },
    { key: "item", kind: "field", default: "Item:" },
    { key: "quantity", kind: "field", default: "Quantity:" },
    { key: "scrapQty", kind: "field", default: "Scrap Qty:" },
    { key: "target", kind: "field", default: "Target:" },
    { key: "salesOrder", kind: "text", default: "Sales Order:" },
    { key: "makeToOrder", kind: "text", default: "Make to Order" },
    { key: "inventory", kind: "text", default: "Inventory" },
    { key: "customer", kind: "field", default: "Customer:" },
    { key: "startDate", kind: "field", default: "Start Date:" },
    { key: "dueDate", kind: "field", default: "Due Date:" },
    { key: "deadlineType", kind: "field", default: "Deadline Type:" }
  ],
  operations: [
    { key: "seq", kind: "column", default: "Seq" },
    { key: "operation", kind: "text", default: "Operation" },
    { key: "expectedTimes", kind: "column", default: "Expected Times" },
    { key: "expectedSetup", kind: "field", default: "Setup:" },
    { key: "expectedLabor", kind: "field", default: "Labor:" },
    { key: "expectedMachine", kind: "field", default: "Machine:" },
    { key: "actions", kind: "heading", default: "Actions" },
    // Printed before a batched operation's batch id.
    { key: "batch", kind: "heading", default: "Batch" },
    { key: "openInMes", kind: "text", default: "Open in MES" },
    {
      key: "batchInstructions",
      kind: "text",
      default:
        "This operation runs with other jobs as one batch. Start and complete it from the batch in MES."
    },
    { key: "actionSetup", kind: "text", default: "Setup" },
    { key: "actionLabor", kind: "text", default: "Labor" },
    { key: "actionMachine", kind: "text", default: "Machine" },
    { key: "complete", kind: "text", default: "Complete" },
    { key: "batchNotes", kind: "heading", default: "Batch Notes" },
    { key: "procedureSteps", kind: "heading", default: "Procedure Steps" },
    { key: "procedureStep", kind: "heading", default: "Procedure Step" },
    { key: "workInstructions", kind: "heading", default: "Work Instructions" }
  ],
  notes: [{ key: "jobNotes", kind: "heading", default: "Job Notes" }]
} as const satisfies DocumentTextCatalog;
