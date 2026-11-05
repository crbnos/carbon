// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { FOOTER_TEXTS } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const jobTravelerTexts = {
  document: [
    { key: "title", kind: "heading", default: "Job Traveler" },
    { key: "documentNumber", kind: "field", default: "{job.number}" },
    // Printed under the document number.
    { key: "salesOrderPrefix", kind: "text", default: "SO# {job.salesOrder}" },
    // The materials table is not a block, so its columns live here.
    { key: "materialsItem", kind: "column", default: "Item" },
    {
      key: "materialsItemCell",
      kind: "value",
      default: "{material.itemId}",
      of: "materialsItem",
      row: "material"
    },
    { key: "materialsDescription", kind: "text", default: "Description" },
    {
      key: "materialsDescriptionCell",
      kind: "value",
      default: "{material.description}",
      of: "materialsDescription",
      row: "material"
    },
    { key: "materialsQuantity", kind: "column", default: "Quantity" },
    {
      key: "materialsQuantityCell",
      kind: "value",
      default: "{material.quantity} {material.unit}",
      of: "materialsQuantity",
      row: "material"
    },
    ...FOOTER_TEXTS
  ],
  jobDetails: [
    { key: "jobId", kind: "field", default: "Job ID:" },
    { key: "jobIdValue", kind: "value", default: "{job.number}", of: "jobId" },
    { key: "partId", kind: "field", default: "Part ID:" },
    {
      key: "partIdValue",
      kind: "value",
      default: "{item.readableId}",
      of: "partId"
    },
    { key: "service", kind: "field", default: "Service:" },
    {
      key: "serviceValue",
      kind: "value",
      default: "{item.readableId}",
      of: "service"
    },
    { key: "methodRevision", kind: "field", default: "Method Revision:" },
    {
      key: "methodRevisionValue",
      kind: "value",
      default: "V{job.methodRevision}",
      of: "methodRevision"
    },
    { key: "tracking", kind: "field", default: "Tracking:" },
    {
      key: "number",
      kind: "value",
      default: "{item.trackingType} Number: {job.batchNumber}",
      of: "tracking"
    },
    { key: "item", kind: "field", default: "Item:" },
    { key: "itemValue", kind: "value", default: "{item.name}", of: "item" },
    { key: "quantity", kind: "field", default: "Quantity:" },
    {
      key: "quantityValue",
      kind: "value",
      default: "{job.quantity} {job.unit}",
      of: "quantity"
    },
    { key: "scrapQty", kind: "field", default: "Scrap Qty:" },
    {
      key: "scrapQtyValue",
      kind: "value",
      default: "{job.scrapQuantity} {job.unit}",
      of: "scrapQty"
    },
    { key: "target", kind: "field", default: "Target:" },
    {
      key: "salesOrder",
      kind: "value",
      default: "Sales Order: {job.salesOrder}",
      of: "target"
    },
    { key: "makeToOrder", kind: "text", default: "Make to Order" },
    { key: "inventory", kind: "text", default: "Inventory" },
    { key: "customer", kind: "field", default: "Customer:" },
    {
      key: "customerValue",
      kind: "value",
      default: "{customer.name}",
      of: "customer"
    },
    { key: "startDate", kind: "field", default: "Start Date:" },
    {
      key: "startDateValue",
      kind: "value",
      default: "{job.startDate}",
      of: "startDate"
    },
    { key: "dueDate", kind: "field", default: "Due Date:" },
    {
      key: "dueDateValue",
      kind: "value",
      default: "{job.dueDate}",
      of: "dueDate"
    },
    { key: "deadlineType", kind: "field", default: "Deadline Type:" },
    {
      key: "deadlineTypeValue",
      kind: "value",
      default: "{job.deadlineType}",
      of: "deadlineType"
    }
  ],
  operations: [
    { key: "seq", kind: "column", default: "Seq" },
    {
      key: "seqCell",
      kind: "value",
      default: "{operation.seq}",
      of: "seq",
      row: "operation"
    },
    { key: "operation", kind: "text", default: "Operation" },
    {
      key: "operationCell",
      kind: "value",
      default: "{operation.description}",
      of: "operation",
      row: "operation"
    },
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
    {
      key: "batchValue",
      kind: "value",
      default: "{operation.batch}",
      of: "batch",
      row: "operation"
    },
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
    {
      key: "stepNameCell",
      kind: "value",
      default: "{step.name}",
      of: "procedureSteps",
      row: "step"
    },
    { key: "procedureStep", kind: "heading", default: "Procedure Step" },
    { key: "workInstructions", kind: "heading", default: "Work Instructions" }
  ],
  notes: [{ key: "jobNotes", kind: "heading", default: "Job Notes" }]
} as const satisfies DocumentTextCatalog;
