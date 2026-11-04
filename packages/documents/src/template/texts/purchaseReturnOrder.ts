// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { FOOTER_TEXTS } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const purchaseReturnOrderTexts = {
  document: [
    { key: "title", kind: "heading", default: "Return to Supplier" },
    // The label before the supplier's RMA number under the document id.
    { key: "supplierRmaNumber", kind: "text", default: "Supplier RMA #:" },
    ...FOOTER_TEXTS
  ],
  parties: [
    { key: "returnTo", kind: "heading", default: "Return To" },
    { key: "returnDetails", kind: "heading", default: "Return Details" },
    { key: "returnNumber", kind: "field", default: "Return Number:" },
    { key: "supplierRmaNumber", kind: "field", default: "Supplier RMA #:" },
    { key: "date", kind: "field", default: "Date:" },
    { key: "expires", kind: "field", default: "Expires:" },
    { key: "shipFrom", kind: "heading", default: "Ship From" }
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
