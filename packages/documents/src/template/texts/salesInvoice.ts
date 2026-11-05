// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { addressTexts, FOOTER_TEXTS } from "./shared";
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
    {
      key: "numberCell",
      kind: "value",
      default: "{line.number}",
      of: "number",
      row: "line"
    },
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
    { key: "taxAndFees", kind: "text", default: "Tax & Fees" },
    { key: "shipping", kind: "text", default: "- Shipping" },
    {
      key: "shippingValue",
      kind: "value",
      default: "{line.shipping}",
      of: "shipping",
      row: "line"
    },
    { key: "addOn", kind: "text", default: "- Add-On" },
    {
      key: "addOnValue",
      kind: "value",
      default: "{line.addOn}",
      of: "addOn",
      row: "line"
    },
    { key: "nonTaxableAddOn", kind: "text", default: "- Non-Taxable Add-On" },
    {
      key: "nonTaxableAddOnValue",
      kind: "value",
      default: "{line.nonTaxableAddOn}",
      of: "nonTaxableAddOn",
      row: "line"
    },
    {
      key: "tax",
      kind: "text",
      default: "- Tax ({line.taxPercent})",
      row: "line"
    },
    {
      key: "taxValue",
      kind: "value",
      default: "{line.taxAmount}",
      of: "tax",
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
    { key: "unitPrice", kind: "column", default: "Unit Price" },
    {
      key: "unitPriceCell",
      kind: "value",
      default: "{line.unitPrice}",
      of: "unitPrice",
      row: "line"
    },
    {
      key: "discountCell",
      kind: "value",
      default: "{line.discountPercent}",
      of: "unitPrice",
      row: "line"
    },
    { key: "total", kind: "column", default: "Total" },
    {
      key: "totalCell",
      kind: "value",
      default: "{line.total}",
      of: "total",
      row: "line"
    }
  ],
  summary: [
    { key: "subtotal", kind: "text", default: "Subtotal ({invoice.currency})" },
    {
      key: "subtotalValue",
      kind: "value",
      default: "{invoice.subtotal}",
      of: "subtotal"
    },
    { key: "discount", kind: "text", default: "Discount ({invoice.currency})" },
    {
      key: "discountValue",
      kind: "value",
      default: "{invoice.discount}",
      of: "discount"
    },
    { key: "addOns", kind: "text", default: "Add-Ons ({invoice.currency})" },
    {
      key: "addOnsValue",
      kind: "value",
      default: "{invoice.addOns}",
      of: "addOns"
    },
    { key: "shipping", kind: "text", default: "Shipping ({invoice.currency})" },
    {
      key: "shippingValue",
      kind: "value",
      default: "{invoice.shipping}",
      of: "shipping"
    },
    { key: "taxValue", kind: "value", default: "{invoice.tax}" },
    { key: "total", kind: "text", default: "Total ({invoice.currency})" },
    {
      key: "totalValue",
      kind: "value",
      default: "{invoice.total}",
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
