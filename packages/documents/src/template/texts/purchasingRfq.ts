// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { FOOTER_TEXTS } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const purchasingRfqTexts = {
  document: [
    { key: "title", kind: "heading", default: "Request for Quote" },
    ...FOOTER_TEXTS
  ],
  parties: [
    { key: "date", kind: "field", default: "Date" },
    { key: "reference", kind: "field", default: "Reference" },
    { key: "quotationDue", kind: "field", default: "Quotation due" },
    { key: "dearSupplier", kind: "text", default: "Dear Supplier," },
    // The invitation sentence is printed as: invitation, then " by " and the
    // due date, then ", quoting reference " and the RFQ id, then the full stop.
    {
      key: "invitation",
      kind: "text",
      default:
        "We invite you to quote for the items listed below. Please send your quotation in your usual format"
    },
    { key: "by", kind: "text", default: " by " },
    { key: "quotingReference", kind: "text", default: ", quoting reference " },
    { key: "invitationEnd", kind: "text", default: "." },
    {
      key: "yourQuotationShouldInclude",
      kind: "text",
      default: "Your quotation should include:"
    },
    {
      key: "includes1",
      kind: "text",
      default: "a unit price for each quantity, in the unit of measure shown"
    },
    {
      key: "includes2",
      kind: "text",
      default: "your lead time from receipt of order"
    },
    {
      key: "includes3",
      kind: "text",
      default: "how long your prices remain valid"
    },
    {
      key: "includes4",
      kind: "text",
      default: "freight and delivery terms to the address below"
    },
    { key: "deliverTo", kind: "heading", default: "Deliver to" },
    {
      key: "sendYourQuotationTo",
      kind: "heading",
      default: "Send your quotation to"
    }
  ],
  lineItems: [
    { key: "number", kind: "column", default: "#" },
    { key: "item", kind: "text", default: "Item" },
    { key: "quantity", kind: "column", default: "Quantity" },
    { key: "unit", kind: "column", default: "Unit" }
  ],
  notes: [
    { key: "notes", kind: "heading", default: "Notes" },
    {
      key: "thankYou",
      kind: "text",
      default: "Thank you. We look forward to receiving your quotation."
    },
    { key: "sincerely", kind: "text", default: "Sincerely," }
  ],
  terms: [
    {
      key: "termsAndConditions",
      kind: "heading",
      default: "Terms and Conditions"
    }
  ]
} as const satisfies DocumentTextCatalog;
