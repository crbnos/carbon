// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { FOOTER_TEXTS } from "./shared";
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
    {
      key: "itemValue",
      kind: "value",
      default: "{association.id}",
      of: "item",
      row: "association"
    },
    {
      key: "disposition",
      kind: "value",
      default: "{association.disposition}",
      of: "item",
      row: "association"
    },
    {
      key: "qty",
      kind: "field",
      default: "Qty: {association.quantity}",
      row: "association"
    },
    { key: "customer", kind: "text", default: "Customer:" },
    {
      key: "customerValue",
      kind: "value",
      default: "{association.id}",
      of: "customer",
      row: "association"
    },
    { key: "supplier", kind: "text", default: "Supplier:" },
    {
      key: "supplierValue",
      kind: "value",
      default: "{association.id}",
      of: "supplier",
      row: "association"
    },
    { key: "jobOperation", kind: "text", default: "Job Operation:" },
    {
      key: "jobOperationValue",
      kind: "value",
      default: "{association.id}",
      of: "jobOperation",
      row: "association"
    },
    { key: "purchaseOrder", kind: "text", default: "Purchase Order:" },
    {
      key: "purchaseOrderValue",
      kind: "value",
      default: "{association.id}",
      of: "purchaseOrder",
      row: "association"
    },
    { key: "salesOrder", kind: "text", default: "Sales Order:" },
    {
      key: "salesOrderValue",
      kind: "value",
      default: "{association.id}",
      of: "salesOrder",
      row: "association"
    },
    { key: "shipment", kind: "text", default: "Shipment:" },
    {
      key: "shipmentValue",
      kind: "value",
      default: "{association.id}",
      of: "shipment",
      row: "association"
    },
    { key: "receipt", kind: "text", default: "Receipt:" },
    {
      key: "receiptValue",
      kind: "value",
      default: "{association.id}",
      of: "receipt",
      row: "association"
    },
    { key: "trackedEntity", kind: "text", default: "Tracked Entity:" },
    {
      key: "trackedEntityValue",
      kind: "value",
      default: "{association.id}",
      of: "trackedEntity",
      row: "association"
    }
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
    {
      key: "supplierValue",
      kind: "value",
      default: "{task.supplier}",
      of: "supplier",
      row: "task"
    },
    { key: "verifiedBy", kind: "field", default: "Verified by:" },
    {
      key: "verifiedByValue",
      kind: "value",
      default: "{task.assignee}",
      of: "verifiedBy",
      row: "task"
    },
    { key: "completedBy", kind: "field", default: "Completed by:" },
    {
      key: "completedByValue",
      kind: "value",
      default: "{task.assignee}",
      of: "completedBy",
      row: "task"
    },
    { key: "completedOn", kind: "field", default: "Completed on:" },
    {
      key: "completedOnValue",
      kind: "value",
      default: "{task.completedDate}",
      of: "completedOn",
      row: "task"
    },
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
