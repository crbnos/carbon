// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { FOOTER_TEXTS } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const issueTexts = {
  document: [
    { key: "title", kind: "heading", default: "Issue Report" },
    { key: "issueNumber", kind: "text", default: "Issue #" },
    ...FOOTER_TEXTS
  ],
  issueDetails: [
    { key: "issueDetails", kind: "heading", default: "Issue Details" },
    { key: "type", kind: "field", default: "Type:" },
    { key: "status", kind: "field", default: "Status:" },
    { key: "initiatedBy", kind: "field", default: "Initiated By:" },
    // Printed when the person who opened the issue is not known.
    { key: "unknown", kind: "text", default: "Unknown" },
    { key: "dates", kind: "heading", default: "Dates" },
    { key: "started", kind: "field", default: "Started:" },
    { key: "completed", kind: "field", default: "Completed:" }
  ],
  associations: [
    { key: "associations", kind: "heading", default: "Associations" },
    // The label of each row, by what the row links to.
    { key: "item", kind: "text", default: "Item:" },
    { key: "qty", kind: "field", default: "Qty:" },
    { key: "customer", kind: "text", default: "Customer:" },
    { key: "supplier", kind: "text", default: "Supplier:" },
    { key: "jobOperation", kind: "text", default: "Job Operation:" },
    { key: "purchaseOrder", kind: "text", default: "Purchase Order:" },
    { key: "salesOrder", kind: "text", default: "Sales Order:" },
    { key: "shipment", kind: "text", default: "Shipment:" },
    { key: "receipt", kind: "text", default: "Receipt:" },
    { key: "trackedEntity", kind: "text", default: "Tracked Entity:" }
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
    { key: "supplierPrefix", kind: "text", default: "Supplier " },
    { key: "supplier", kind: "field", default: "Supplier:" },
    { key: "verifiedBy", kind: "field", default: "Verified by:" },
    { key: "completedBy", kind: "field", default: "Completed by:" },
    { key: "completedOn", kind: "field", default: "Completed on:" },
    { key: "inspections", kind: "heading", default: "Inspections" },
    // Printed before the job id of an inspection record.
    { key: "job", kind: "text", default: "Job" },
    { key: "unknown", kind: "text", default: "Unknown" }
  ],
  reviewers: [{ key: "mrb", kind: "heading", default: "MRB" }]
} as const satisfies DocumentTextCatalog;
