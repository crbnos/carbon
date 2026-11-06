// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cell, FOOTER_TEXTS } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const issueTexts = {
  document: [
    { key: "title", kind: "heading", default: "Issue Report" },
    { key: "documentNumber", kind: "field", default: "{issue.number}" },
    { key: "issueNumber", kind: "text", default: "Issue #{issue.number}" },
    ...FOOTER_TEXTS
  ],
  issueDetails: [
    { key: "issueDetails", kind: "heading", default: "Issue Details" },
    { key: "name", kind: "field", default: "{issue.name}" },
    { key: "type", kind: "field", default: "Type: {issue.type}" },
    { key: "status", kind: "field", default: "Status: {issue.status}" },
    {
      key: "initiatedBy",
      kind: "field",
      default: "Initiated By: {issue.initiatedBy}"
    },
    // Printed when the person who opened the issue is not known.
    { key: "unknown", kind: "text", default: "Unknown" },
    { key: "dates", kind: "heading", default: "Dates" },
    { key: "started", kind: "field", default: "Started: {issue.openDate}" },
    { key: "completed", kind: "field", default: "Completed: {issue.closeDate}" }
  ],
  associations: [
    { key: "associations", kind: "heading", default: "Associations" },
    // The label of each row, by what the row links to.
    { key: "item", kind: "text", default: "Item:" },
    cell("itemValue", "{association.id}", "item", "association"),
    cell("disposition", "{association.disposition}", "item", "association"),
    {
      key: "qty",
      kind: "field",
      default: "Qty: {association.quantity}",
      row: "association"
    },
    { key: "customer", kind: "text", default: "Customer:" },
    cell("customerValue", "{association.id}", "customer", "association"),
    { key: "supplier", kind: "text", default: "Supplier:" },
    cell("supplierValue", "{association.id}", "supplier", "association"),
    { key: "jobOperation", kind: "text", default: "Job Operation:" },
    cell(
      "jobOperationValue",
      "{association.id}",
      "jobOperation",
      "association"
    ),
    { key: "purchaseOrder", kind: "text", default: "Purchase Order:" },
    cell(
      "purchaseOrderValue",
      "{association.id}",
      "purchaseOrder",
      "association"
    ),
    { key: "salesOrder", kind: "text", default: "Sales Order:" },
    cell("salesOrderValue", "{association.id}", "salesOrder", "association"),
    { key: "shipment", kind: "text", default: "Shipment:" },
    cell("shipmentValue", "{association.id}", "shipment", "association"),
    { key: "receipt", kind: "text", default: "Receipt:" },
    cell("receiptValue", "{association.id}", "receipt", "association"),
    { key: "trackedEntity", kind: "text", default: "Tracked Entity:" },
    cell(
      "trackedEntityValue",
      "{association.id}",
      "trackedEntity",
      "association"
    )
  ],
  notes: [
    {
      key: "descriptionOfIssue",
      kind: "heading",
      default: "Description of Issue"
    }
  ],
  actionTasks: [
    // Printed before the action name of a supplier's task.
    { key: "supplierPrefix", kind: "text", default: "Supplier" },
    { key: "actionName", kind: "value", default: "{task.action}", row: "task" },
    { key: "supplier", kind: "field", default: "Supplier:" },
    cell("supplierValue", "{task.supplier}", "supplier", "task"),
    { key: "verifiedBy", kind: "field", default: "Verified by:" },
    cell("verifiedByValue", "{task.assignee}", "verifiedBy", "task"),
    { key: "completedBy", kind: "field", default: "Completed by:" },
    cell("completedByValue", "{task.assignee}", "completedBy", "task"),
    { key: "completedOn", kind: "field", default: "Completed on:" },
    cell("completedOnValue", "{task.completedDate}", "completedOn", "task"),
    { key: "inspections", kind: "heading", default: "Inspections" },
    {
      key: "stepCell",
      kind: "value",
      default: "{inspection.step}",
      row: "inspection"
    },
    // Printed before the rest of the record, only when the record has a job.
    {
      key: "job",
      kind: "value",
      default: "Job {inspection.job} •",
      row: "inspection"
    },
    {
      key: "recordCell",
      kind: "value",
      default: "{inspection.recordedBy} • {inspection.date}",
      row: "inspection"
    },
    // Printed when the person who made the record is not known.
    { key: "unknown", kind: "text", default: "Unknown" }
  ],
  reviewers: [
    { key: "mrb", kind: "heading", default: "MRB" },
    {
      key: "titleCell",
      kind: "value",
      default: "{reviewer.title}",
      row: "reviewer"
    },
    {
      key: "statusCell",
      kind: "value",
      default: "{reviewer.status}",
      row: "reviewer"
    }
  ]
} as const satisfies DocumentTextCatalog;
