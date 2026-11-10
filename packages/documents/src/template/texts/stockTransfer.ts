// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cell, FOOTER_TEXTS, valueOf } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const stockTransferTexts = {
  document: [
    { key: "title", kind: "heading", default: "Stock Transfer" },
    { key: "documentNumber", kind: "field", default: "{transfer.number}" },
    ...FOOTER_TEXTS
  ],
  // The summary box prints ":" after each transfer label itself.
  details: [
    { key: "companyName", kind: "field", default: "{company.name}" },
    {
      key: "companyAddressLine1",
      kind: "field",
      default: "{company.addressLine1}"
    },
    {
      key: "companyAddressLine2",
      kind: "field",
      default: "{company.addressLine2}"
    },
    { key: "companyCity", kind: "field", default: "{company.city}" },
    {
      key: "companyStatePostal",
      kind: "field",
      default: "{company.statePostal}"
    },
    { key: "phone", kind: "field", default: "Phone: {company.phone}" },
    { key: "email", kind: "field", default: "Email: {company.email}" },
    { key: "website", kind: "field", default: "Website: {company.website}" },
    { key: "date", kind: "field", default: "Date" },
    valueOf("dateValue", "{transfer.date}", "date"),
    { key: "stockTransfer", kind: "field", default: "Stock Transfer" },
    valueOf("stockTransferValue", "{transfer.number}", "stockTransfer"),
    { key: "location", kind: "field", default: "Location" },
    valueOf("locationValue", "{transfer.location}", "location"),
    { key: "assignee", kind: "field", default: "Assignee" },
    valueOf("assigneeValue", "{transfer.assignee}", "assignee")
  ],
  lineItems: [
    { key: "description", kind: "text", default: "Description" },
    cell("descriptionCell", "{line.description}", "description", "line"),
    cell("itemIdCell", "{line.itemId}", "description", "line"),
    { key: "transfer", kind: "column", default: "Transfer" },
    cell("transferCell", "{line.from} → {line.to}", "transfer", "line"),
    { key: "qty", kind: "column", default: "Qty" },
    cell("qtyCell", "{line.quantity} {line.unit}", "qty", "line"),
    { key: "pick", kind: "column", default: "Pick" },
    // Printed for a line with no storage unit on one side.
    { key: "any", kind: "text", default: "Any" }
  ]
} as const satisfies DocumentTextCatalog;
