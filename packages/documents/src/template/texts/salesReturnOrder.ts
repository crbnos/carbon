// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { FOOTER_TEXTS } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const salesReturnOrderTexts = {
  document: [
    {
      key: "title",
      kind: "heading",
      default: "Return Merchandise Authorization"
    },
    ...FOOTER_TEXTS
  ],
  parties: [
    { key: "customer", kind: "heading", default: "Customer" },
    { key: "returnDetails", kind: "heading", default: "Return Details" },
    { key: "rmaNumber", kind: "field", default: "RMA Number:" },
    { key: "date", kind: "field", default: "Date:" },
    { key: "expires", kind: "field", default: "Expires:" },
    { key: "customerRef", kind: "field", default: "Customer Ref:" },
    { key: "returnTo", kind: "heading", default: "Return To" }
  ],
  notes: [
    { key: "notes", kind: "heading", default: "Notes" },
    { key: "none", kind: "text", default: "None" }
  ],
  lineItems: [
    { key: "number", kind: "column", default: "#" },
    { key: "item", kind: "text", default: "Item" },
    { key: "qtyAuthorized", kind: "column", default: "Qty Authorized" },
    { key: "unitPrice", kind: "column", default: "Unit Price" },
    { key: "reason", kind: "column", default: "Reason" },
    { key: "total", kind: "text", default: "Total" }
  ],
  terms: [
    {
      key: "termsAndConditions",
      kind: "heading",
      default: "Terms & Conditions"
    }
  ]
} as const satisfies DocumentTextCatalog;
