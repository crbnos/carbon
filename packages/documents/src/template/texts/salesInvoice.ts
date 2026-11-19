// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { addressTexts, cell, FOOTER_TEXTS, valueOf } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const salesInvoiceTexts = {
  document: [
    { key: "title", kind: "heading", default: "Invoice" },
    { key: "documentNumber", kind: "field", default: "{invoice.number}" },
    ...FOOTER_TEXTS
  ],
  parties: [
    { key: "billTo", kind: "heading", default: "Bill To" },
    ...addressTexts("billTo", "customer"),
    { key: "taxId", kind: "field", default: "Tax ID: {customer.taxId}" },
    { key: "vat", kind: "field", default: "VAT: {customer.vatNumber}" },
    { key: "eori", kind: "field", default: "EORI: {customer.eori}" },
    {
      key: "contact",
      kind: "field",
      default: "Contact: {customer.contactName}"
    },
    { key: "email", kind: "field", default: "Email: {customer.contactEmail}" },
    { key: "invoiceDetails", kind: "heading", default: "Invoice Details" },
    {
      key: "dateIssued",
      kind: "field",
      default: "Date Issued: {invoice.dateIssued}"
    },
    { key: "dueDate", kind: "field", default: "Due Date: {invoice.dateDue}" },
    {
      key: "customerRef",
      kind: "field",
      default: "Customer Ref: {invoice.customerReference}"
    },
    // One row: "Sales Order:" for one order, "Sales Orders:" for several.
    // Hiding `salesOrder` hides the row either way.
    {
      key: "salesOrder",
      kind: "field",
      default: "Sales Order: {invoice.salesOrders}"
    },
    {
      key: "salesOrders",
      kind: "text",
      default: "Sales Orders: {invoice.salesOrders}"
    },
    {
      key: "paymentTerms",
      kind: "field",
      default: "Payment Terms: {invoice.paymentTerms}"
    },
    {
      key: "shipping",
      kind: "field",
      default: "Shipping: {invoice.shippingMethod}"
    },
    {
      key: "shippingTerms",
      kind: "field",
      default: "Shipping Terms: {invoice.shippingTerms}"
    },
    { key: "incoterm", kind: "field", default: "Incoterm: {invoice.incoterm}" },
    { key: "shipTo", kind: "heading", default: "Ship To" },
    ...addressTexts("shipTo")
  ],
  notes: [
    { key: "notes", kind: "heading", default: "Notes" },
    { key: "none", kind: "text", default: "None" }
  ],
  lineItems: [
    { key: "number", kind: "column", default: "#" },
    cell("numberCell", "{line.number}", "number", "line"),
    { key: "description", kind: "text", default: "Description" },
    cell("descriptionCell", "{line.description}", "description", "line"),
    cell("detailsCell", "{line.details}", "description", "line"),
    { key: "taxAndFees", kind: "text", default: "Tax & Fees" },
    { key: "shipping", kind: "text", default: "- Shipping" },
    cell("shippingValue", "{line.shipping}", "shipping", "line"),
    { key: "addOn", kind: "text", default: "- Add-On" },
    cell("addOnValue", "{line.addOn}", "addOn", "line"),
    { key: "nonTaxableAddOn", kind: "text", default: "- Non-Taxable Add-On" },
    cell(
      "nonTaxableAddOnValue",
      "{line.nonTaxableAddOn}",
      "nonTaxableAddOn",
      "line"
    ),
    {
      key: "tax",
      kind: "text",
      default: "- Tax ({line.taxPercent})",
      row: "line"
    },
    cell("taxValue", "{line.taxAmount}", "tax", "line"),
    { key: "qty", kind: "column", default: "Qty" },
    cell("qtyCell", "{line.quantity} {line.unit}", "qty", "line"),
    { key: "unitPrice", kind: "column", default: "Unit Price" },
    cell("unitPriceCell", "{line.unitPrice}", "unitPrice", "line"),
    cell("discountCell", "{line.discountPercent}", "unitPrice", "line"),
    { key: "total", kind: "column", default: "Total" },
    cell("totalCell", "{line.total}", "total", "line")
  ],
  summary: [
    { key: "subtotal", kind: "text", default: "Subtotal ({invoice.currency})" },
    valueOf("subtotalValue", "{invoice.subtotal}", "subtotal"),
    { key: "discount", kind: "text", default: "Discount ({invoice.currency})" },
    valueOf("discountValue", "{invoice.discount}", "discount"),
    { key: "addOns", kind: "text", default: "Add-Ons ({invoice.currency})" },
    valueOf("addOnsValue", "{invoice.addOns}", "addOns"),
    { key: "shipping", kind: "text", default: "Shipping ({invoice.currency})" },
    valueOf("shippingValue", "{invoice.shipping}", "shipping"),
    { key: "taxValue", kind: "value", default: "{invoice.tax}" },
    { key: "total", kind: "text", default: "Total ({invoice.currency})" },
    valueOf("totalValue", "{invoice.total}", "total")
  ],
  terms: [
    {
      key: "termsAndConditions",
      kind: "heading",
      default: "Terms & Conditions"
    }
  ]
} as const satisfies DocumentTextCatalog;
