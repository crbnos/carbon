// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { addressTexts, cell, FOOTER_TEXTS, valueOf } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const quoteTexts = {
  document: [
    { key: "title", kind: "heading", default: "Quote" },
    { key: "documentNumber", kind: "field", default: "{quote.number}" },
    ...FOOTER_TEXTS
  ],
  parties: [
    { key: "to", kind: "heading", default: "To" },
    ...addressTexts("customer"),
    { key: "taxId", kind: "field", default: "Tax ID: {customer.taxId}" },
    { key: "vat", kind: "field", default: "VAT: {customer.vatNumber}" },
    { key: "eori", kind: "field", default: "EORI: {customer.eori}" },
    {
      key: "contact",
      kind: "field",
      default: "Contact: {customer.contactName}"
    },
    { key: "email", kind: "field", default: "Email: {customer.contactEmail}" },
    { key: "quoteDetails", kind: "heading", default: "Quote Details" },
    { key: "date", kind: "field", default: "Date: {quote.date}" },
    {
      key: "expires",
      kind: "field",
      default: "Expires: {quote.expirationDate}"
    },
    {
      key: "reference",
      kind: "field",
      default: "Reference: {quote.customerReference}"
    },
    {
      key: "maxLeadTime",
      kind: "field",
      default: "Max Lead Time: {quote.maxLeadTime}"
    },
    {
      key: "paymentTerms",
      kind: "field",
      default: "Payment Terms: {quote.paymentTerms}"
    },
    { key: "incoterm", kind: "field", default: "Incoterm: {quote.incoterm}" }
  ],
  notes: [
    { key: "notes", kind: "heading", default: "Notes" },
    { key: "none", kind: "text", default: "None" }
  ],
  // Three kinds of row: `line` prints once per line, `price` once per quantity
  // of a line, `charge` once per additional charge of a quantity.
  lineItems: [
    { key: "description", kind: "text", default: "Description" },
    cell("descriptionCell", "{line.description}", "description", "line"),
    cell("detailsCell", "{line.details}", "description", "line"),
    { key: "qty", kind: "column", default: "Qty" },
    cell("qtyCell", "{price.quantity} EA", "qty", "price"),
    { key: "unitPrice", kind: "column", default: "Unit Price" },
    cell("unitPriceCell", "{price.unitPrice}", "unitPrice", "price"),
    // "Tax & Fees" is both a column header and the heading of a line's
    // tax and fee rows, so each key carries its section.
    {
      key: "columnTaxAndFees",
      kind: "column",
      default: "Tax & Fees",
      section: "column"
    },
    cell(
      "columnTaxAndFeesCell",
      "{price.taxAndFees}",
      "columnTaxAndFees",
      "price"
    ),
    { key: "leadTime", kind: "column", default: "Lead Time" },
    cell("leadTimeCell", "{price.leadTime}", "leadTime", "price"),
    { key: "total", kind: "column", default: "Total" },
    cell("totalCell", "{price.total}", "total", "price"),
    {
      key: "lineTaxAndFees",
      kind: "text",
      default: "Tax & Fees",
      section: "lineDetail"
    },
    { key: "shipping", kind: "text", default: "- Shipping" },
    cell("shippingValue", "{price.shipping}", "shipping", "price"),
    {
      key: "charge",
      kind: "text",
      default: "- {charge.description}",
      row: "charge"
    },
    cell("chargeValue", "{charge.amount}", "charge", "charge"),
    {
      key: "tax",
      kind: "text",
      default: "- Tax ({price.taxPercent})",
      row: "price"
    },
    cell("taxValue", "{price.tax}", "tax", "price")
  ],
  summary: [
    { key: "subtotal", kind: "text", default: "Subtotal ({quote.currency})" },
    valueOf("subtotalValue", "{quote.subtotal}", "subtotal"),
    { key: "shipping", kind: "text", default: "Shipping ({quote.currency})" },
    valueOf("shippingValue", "{quote.shipping}", "shipping"),
    { key: "fees", kind: "text", default: "Fees ({quote.currency})" },
    valueOf("feesValue", "{quote.fees}", "fees"),
    { key: "taxValue", kind: "value", default: "{quote.tax}" },
    { key: "total", kind: "text", default: "Total ({quote.currency})" },
    valueOf("totalValue", "{quote.total}", "total")
  ],
  terms: [
    {
      key: "termsAndConditions",
      kind: "heading",
      default: "Terms & Conditions"
    }
  ]
} as const satisfies DocumentTextCatalog;
