// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { FOOTER_TEXTS } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const quoteTexts = {
  document: [
    { key: "title", kind: "heading", default: "Quote" },
    ...FOOTER_TEXTS
  ],
  parties: [
    { key: "to", kind: "heading", default: "To" },
    { key: "taxId", kind: "field", default: "Tax ID:" },
    { key: "vat", kind: "field", default: "VAT:" },
    { key: "eori", kind: "field", default: "EORI:" },
    { key: "contact", kind: "field", default: "Contact:" },
    { key: "email", kind: "field", default: "Email:" },
    { key: "quoteDetails", kind: "heading", default: "Quote Details" },
    { key: "date", kind: "field", default: "Date:" },
    { key: "expires", kind: "field", default: "Expires:" },
    { key: "reference", kind: "field", default: "Reference:" },
    { key: "maxLeadTime", kind: "field", default: "Max Lead Time:" },
    { key: "paymentTerms", kind: "field", default: "Payment Terms:" },
    { key: "incoterm", kind: "field", default: "Incoterm:" }
  ],
  notes: [
    { key: "notes", kind: "heading", default: "Notes" },
    { key: "none", kind: "text", default: "None" }
  ],
  lineItems: [
    { key: "description", kind: "text", default: "Description" },
    { key: "qty", kind: "column", default: "Qty" },
    { key: "unitPrice", kind: "column", default: "Unit Price" },
    // "Tax & Fees" is both a column header and the heading of a line's
    // tax and fee rows, so each key carries its section.
    {
      key: "columnTaxAndFees",
      kind: "column",
      default: "Tax & Fees",
      section: "column"
    },
    { key: "leadTime", kind: "column", default: "Lead Time" },
    { key: "total", kind: "column", default: "Total" },
    {
      key: "lineTaxAndFees",
      kind: "text",
      default: "Tax & Fees",
      section: "lineDetail"
    },
    { key: "shipping", kind: "text", default: "- Shipping" },
    { key: "tax", kind: "text", default: "- Tax" }
  ],
  summary: [
    { key: "subtotal", kind: "text", default: "Subtotal" },
    { key: "shipping", kind: "text", default: "Shipping" },
    { key: "fees", kind: "text", default: "Fees" },
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
