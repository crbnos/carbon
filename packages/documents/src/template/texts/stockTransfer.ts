// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { FOOTER_TEXTS } from "./shared";
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
    { key: "dateValue", kind: "value", default: "{transfer.date}", of: "date" },
    { key: "stockTransfer", kind: "field", default: "Stock Transfer" },
    {
      key: "stockTransferValue",
      kind: "value",
      default: "{transfer.number}",
      of: "stockTransfer"
    },
    { key: "location", kind: "field", default: "Location" },
    {
      key: "locationValue",
      kind: "value",
      default: "{transfer.location}",
      of: "location"
    },
    { key: "assignee", kind: "field", default: "Assignee" },
    {
      key: "assigneeValue",
      kind: "value",
      default: "{transfer.assignee}",
      of: "assignee"
    }
  ],
  lineItems: [
    { key: "description", kind: "text", default: "Description" },
    {
      key: "descriptionCell",
      kind: "value",
      default: "{line.description}",
      of: "description",
      row: "line"
    },
    {
      key: "itemIdCell",
      kind: "value",
      default: "{line.itemId}",
      of: "description",
      row: "line"
    },
    { key: "transfer", kind: "column", default: "Transfer" },
    {
      key: "transferCell",
      kind: "value",
      default: "{line.from} → {line.to}",
      of: "transfer",
      row: "line"
    },
    { key: "qty", kind: "column", default: "Qty" },
    {
      key: "qtyCell",
      kind: "value",
      default: "{line.quantity} {line.unit}",
      of: "qty",
      row: "line"
    },
    { key: "pick", kind: "column", default: "Pick" },
    // Printed for a line with no storage unit on one side.
    { key: "any", kind: "text", default: "Any" }
  ]
} as const satisfies DocumentTextCatalog;
