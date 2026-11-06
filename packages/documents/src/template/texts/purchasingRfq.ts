// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cell, FOOTER_TEXTS, valueOf } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const purchasingRfqTexts = {
  document: [
    { key: "title", kind: "heading", default: "Request for Quote" },
    ...FOOTER_TEXTS
  ],
  parties: [
    { key: "date", kind: "field", default: "Date" },
    valueOf("dateValue", "{rfq.date}", "date"),
    { key: "reference", kind: "field", default: "Reference" },
    valueOf("referenceValue", "{rfq.number}", "reference"),
    { key: "quotationDue", kind: "field", default: "Quotation due" },
    valueOf("quotationDueValue", "{rfq.dueDate}", "quotationDue"),
    { key: "dearSupplier", kind: "text", default: "Dear Supplier," },
    // The invitation sentence is printed as: invitation, a space and `by`, then
    // `quotingReference`, then the full stop. `by` and `quotingReference` print
    // only when their value is filled in.
    {
      key: "invitation",
      kind: "text",
      default:
        "We invite you to quote for the items listed below. Please send your quotation in your usual format"
    },
    { key: "by", kind: "text", default: "by {rfq.dueDate}" },
    {
      key: "quotingReference",
      kind: "text",
      default: ", quoting reference {rfq.number}"
    },
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
    { key: "deliverToName", kind: "field", default: "{company.name}" },
    {
      key: "deliverToAddressLine1",
      kind: "field",
      default: "{deliverTo.addressLine1}"
    },
    {
      key: "deliverToAddressLine2",
      kind: "field",
      default: "{deliverTo.addressLine2}"
    },
    {
      key: "deliverToCity",
      kind: "field",
      default: "{deliverTo.cityStatePostal}"
    },
    { key: "deliverToCountry", kind: "field", default: "{deliverTo.country}" },
    {
      key: "sendYourQuotationTo",
      kind: "heading",
      default: "Send your quotation to"
    },
    { key: "sendToName", kind: "field", default: "{contact.name}" },
    { key: "sendToEmail", kind: "field", default: "{contact.email}" }
  ],
  lineItems: [
    { key: "number", kind: "column", default: "#" },
    cell("numberCell", "{line.number}", "number", "line"),
    { key: "item", kind: "text", default: "Item" },
    cell("itemCell", "{line.item}", "item", "line"),
    cell("descriptionCell", "{line.description}", "item", "line"),
    { key: "quantity", kind: "column", default: "Quantity" },
    cell("quantityCell", "{line.quantity}", "quantity", "line"),
    { key: "unit", kind: "column", default: "Unit" },
    cell("unitCell", "{line.unit}", "unit", "line")
  ],
  notes: [
    { key: "notes", kind: "heading", default: "Notes" },
    {
      key: "thankYou",
      kind: "text",
      default: "Thank you. We look forward to receiving your quotation."
    },
    { key: "sincerely", kind: "text", default: "Sincerely," },
    { key: "contactName", kind: "field", default: "{contact.name}" },
    { key: "companyName", kind: "field", default: "{company.name}" },
    { key: "contactEmail", kind: "field", default: "{contact.email}" }
  ],
  terms: [
    {
      key: "termsAndConditions",
      kind: "heading",
      default: "Terms and Conditions"
    }
  ]
} as const satisfies DocumentTextCatalog;
