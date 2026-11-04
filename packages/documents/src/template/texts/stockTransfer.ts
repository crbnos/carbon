// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { FOOTER_TEXTS } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const stockTransferTexts = {
  document: [
    { key: "title", kind: "heading", default: "Stock Transfer" },
    ...FOOTER_TEXTS
  ],
  // The summary box prints ":" after each transfer label itself.
  details: [
    { key: "phone", kind: "field", default: "Phone:" },
    { key: "email", kind: "field", default: "Email:" },
    { key: "website", kind: "field", default: "Website:" },
    { key: "date", kind: "field", default: "Date" },
    { key: "stockTransfer", kind: "field", default: "Stock Transfer" },
    { key: "location", kind: "field", default: "Location" },
    { key: "assignee", kind: "field", default: "Assignee" }
  ],
  lineItems: [
    { key: "description", kind: "text", default: "Description" },
    { key: "transfer", kind: "column", default: "Transfer" },
    { key: "qty", kind: "column", default: "Qty" },
    { key: "pick", kind: "column", default: "Pick" },
    // Printed for a line with no storage unit on one side.
    { key: "any", kind: "text", default: "Any" }
  ]
} as const satisfies DocumentTextCatalog;
