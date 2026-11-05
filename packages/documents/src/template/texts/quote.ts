// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { addressTexts, FOOTER_TEXTS } from "./shared";
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
    {
      key: "descriptionCell",
      kind: "value",
      default: "{line.description}",
      of: "description",
      row: "line"
    },
    {
      key: "detailsCell",
      kind: "value",
      default: "{line.details}",
      of: "description",
      row: "line"
    },
    { key: "qty", kind: "column", default: "Qty" },
    {
      key: "qtyCell",
      kind: "value",
      default: "{price.quantity} EA",
      of: "qty",
      row: "price"
    },
    { key: "unitPrice", kind: "column", default: "Unit Price" },
    {
      key: "unitPriceCell",
      kind: "value",
      default: "{price.unitPrice}",
      of: "unitPrice",
      row: "price"
    },
    // "Tax & Fees" is both a column header and the heading of a line's
    // tax and fee rows, so each key carries its section.
    {
      key: "columnTaxAndFees",
      kind: "column",
      default: "Tax & Fees",
      section: "column"
    },
    {
      key: "columnTaxAndFeesCell",
      kind: "value",
      default: "{price.taxAndFees}",
      of: "columnTaxAndFees",
      row: "price"
    },
    { key: "leadTime", kind: "column", default: "Lead Time" },
    {
      key: "leadTimeCell",
      kind: "value",
      default: "{price.leadTime}",
      of: "leadTime",
      row: "price"
    },
    { key: "total", kind: "column", default: "Total" },
    {
      key: "totalCell",
      kind: "value",
      default: "{price.total}",
      of: "total",
      row: "price"
    },
    {
      key: "lineTaxAndFees",
      kind: "text",
      default: "Tax & Fees",
      section: "lineDetail"
    },
    { key: "shipping", kind: "text", default: "- Shipping" },
    {
      key: "shippingValue",
      kind: "value",
      default: "{price.shipping}",
      of: "shipping",
      row: "price"
    },
    {
      key: "charge",
      kind: "text",
      default: "- {charge.description}",
      row: "charge"
    },
    {
      key: "chargeValue",
      kind: "value",
      default: "{charge.amount}",
      of: "charge",
      row: "charge"
    },
    {
      key: "tax",
      kind: "text",
      default: "- Tax ({price.taxPercent})",
      row: "price"
    },
    {
      key: "taxValue",
      kind: "value",
      default: "{price.tax}",
      of: "tax",
      row: "price"
    }
  ],
  summary: [
    { key: "subtotal", kind: "text", default: "Subtotal ({quote.currency})" },
    {
      key: "subtotalValue",
      kind: "value",
      default: "{quote.subtotal}",
      of: "subtotal"
    },
    { key: "shipping", kind: "text", default: "Shipping ({quote.currency})" },
    {
      key: "shippingValue",
      kind: "value",
      default: "{quote.shipping}",
      of: "shipping"
    },
    { key: "fees", kind: "text", default: "Fees ({quote.currency})" },
    { key: "feesValue", kind: "value", default: "{quote.fees}", of: "fees" },
    { key: "taxValue", kind: "value", default: "{quote.tax}" },
    { key: "total", kind: "text", default: "Total ({quote.currency})" },
    {
      key: "totalValue",
      kind: "value",
      default: "{quote.total}",
      of: "total"
    }
  ],
  terms: [
    {
      key: "termsAndConditions",
      kind: "heading",
      default: "Terms & Conditions"
    }
  ]
} as const satisfies DocumentTextCatalog;
