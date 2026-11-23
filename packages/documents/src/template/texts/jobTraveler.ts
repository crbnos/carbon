// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cell, FOOTER_TEXTS, valueOf } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const jobTravelerTexts = {
  document: [
    { key: "title", kind: "heading", default: "Job Traveler" },
    { key: "documentNumber", kind: "field", default: "{job.number}" },
    // Printed under the document number.
    { key: "salesOrderPrefix", kind: "text", default: "SO# {job.salesOrder}" },
    // The materials table is not a block, so its columns live here.
    { key: "materialsItem", kind: "column", default: "Item" },
    cell("materialsItemCell", "{material.itemId}", "materialsItem", "material"),
    { key: "materialsDescription", kind: "text", default: "Description" },
    cell(
      "materialsDescriptionCell",
      "{material.description}",
      "materialsDescription",
      "material"
    ),
    { key: "materialsQuantity", kind: "column", default: "Quantity" },
    cell(
      "materialsQuantityCell",
      "{material.quantity} {material.unit}",
      "materialsQuantity",
      "material"
    ),
    ...FOOTER_TEXTS
  ],
  jobDetails: [
    { key: "jobId", kind: "field", default: "Job ID:" },
    valueOf("jobIdValue", "{job.number}", "jobId"),
    { key: "partId", kind: "field", default: "Part ID:" },
    valueOf("partIdValue", "{item.readableId}", "partId"),
    { key: "service", kind: "field", default: "Service:" },
    valueOf("serviceValue", "{item.readableId}", "service"),
    { key: "methodRevision", kind: "field", default: "Method Revision:" },
    valueOf("methodRevisionValue", "V{job.methodRevision}", "methodRevision"),
    { key: "tracking", kind: "field", default: "Tracking:" },
    valueOf(
      "number",
      "{item.trackingType} Number: {job.batchNumber}",
      "tracking"
    ),
    { key: "item", kind: "field", default: "Item:" },
    valueOf("itemValue", "{item.name}", "item"),
    { key: "quantity", kind: "field", default: "Quantity:" },
    valueOf("quantityValue", "{job.quantity} {job.unit}", "quantity"),
    { key: "scrapQty", kind: "field", default: "Scrap Qty:" },
    valueOf("scrapQtyValue", "{job.scrapQuantity} {job.unit}", "scrapQty"),
    { key: "target", kind: "field", default: "Target:" },
    valueOf("salesOrder", "Sales Order: {job.salesOrder}", "target"),
    { key: "makeToOrder", kind: "text", default: "Make to Order" },
    { key: "inventory", kind: "text", default: "Inventory" },
    { key: "customer", kind: "field", default: "Customer:" },
    valueOf("customerValue", "{customer.name}", "customer"),
    { key: "startDate", kind: "field", default: "Start Date:" },
    valueOf("startDateValue", "{job.startDate}", "startDate"),
    { key: "dueDate", kind: "field", default: "Due Date:" },
    valueOf("dueDateValue", "{job.dueDate}", "dueDate"),
    { key: "deadlineType", kind: "field", default: "Deadline Type:" },
    valueOf("deadlineTypeValue", "{job.deadlineType}", "deadlineType")
  ],
  operations: [
    { key: "seq", kind: "column", default: "Seq" },
    cell("seqCell", "{operation.seq}", "seq", "operation"),
    { key: "operation", kind: "text", default: "Operation" },
    cell("operationCell", "{operation.description}", "operation", "operation"),
    { key: "expectedTimes", kind: "column", default: "Expected Times" },
    {
      key: "expectedSetup",
      kind: "field",
      default: "Setup: {operation.setupTime}",
      of: "expectedTimes",
      row: "operation"
    },
    {
      key: "expectedLabor",
      kind: "field",
      default: "Labor: {operation.laborTime}",
      of: "expectedTimes",
      row: "operation"
    },
    {
      key: "expectedMachine",
      kind: "field",
      default: "Machine: {operation.machineTime}",
      of: "expectedTimes",
      row: "operation"
    },
    { key: "actions", kind: "heading", default: "Actions" },
    // Printed before a batched operation's batch id.
    { key: "batch", kind: "heading", default: "Batch" },
    cell("batchValue", "{operation.batch}", "batch", "operation"),
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
    cell("stepNameCell", "{step.name}", "procedureSteps", "step"),
    { key: "procedureStep", kind: "heading", default: "Procedure Step" },
    { key: "workInstructions", kind: "heading", default: "Work Instructions" }
  ],
  notes: [{ key: "jobNotes", kind: "heading", default: "Job Notes" }]
} as const satisfies DocumentTextCatalog;
