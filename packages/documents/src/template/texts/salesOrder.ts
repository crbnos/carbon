// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { addressTexts, cell, FOOTER_TEXTS, valueOf } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const salesOrderTexts = {
  document: [
    { key: "title", kind: "heading", default: "Sales Order" },
    { key: "documentNumber", kind: "field", default: "{order.number}" },
    ...FOOTER_TEXTS
  ],
  parties: [
    { key: "customer", kind: "heading", default: "Customer" },
    ...addressTexts("customer"),
    { key: "taxId", kind: "field", default: "Tax ID: {customer.taxId}" },
    { key: "vat", kind: "field", default: "VAT: {customer.vatNumber}" },
    { key: "eori", kind: "field", default: "EORI: {customer.eori}" },
    { key: "orderDetails", kind: "heading", default: "Order Details" },
    { key: "date", kind: "field", default: "Date: {order.date}" },
    {
      key: "customerRef",
      kind: "field",
      default: "Customer Ref: {order.customerReference}"
    },
    {
      key: "requested",
      kind: "field",
      default: "Requested: {order.requestedDate}"
    },
    {
      key: "promised",
      kind: "field",
      default: "Promised: {order.promisedDate}"
    },
    {
      key: "paymentTerms",
      kind: "field",
      default: "Payment Terms: {order.paymentTerms}"
    },
    {
      key: "shipping",
      kind: "field",
      default: "Shipping: {order.shippingMethod}"
    },
    {
      key: "shippingTerms",
      kind: "field",
      default: "Shipping Terms: {order.shippingTerms}"
    },
    { key: "incoterm", kind: "field", default: "Incoterm: {order.incoterm}" },
    { key: "billTo", kind: "heading", default: "Bill To" },
    ...addressTexts("billTo")
  ],
  notes: [
    { key: "notes", kind: "heading", default: "Notes" },
    { key: "none", kind: "text", default: "None" }
  ],
  lineItems: [
    { key: "description", kind: "text", default: "Description" },
    cell("descriptionCell", "{line.description}", "description", "line"),
    cell("detailsCell", "{line.details}", "description", "line"),
    { key: "qty", kind: "column", default: "Qty" },
    cell("qtyCell", "{line.quantity} {line.unit}", "qty", "line"),
    { key: "unitPrice", kind: "column", default: "Unit Price" },
    cell("unitPriceCell", "{line.unitPrice}", "unitPrice", "line"),
    { key: "total", kind: "column", default: "Total" },
    cell("totalCell", "{line.total}", "total", "line"),
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
    cell("taxValue", "{line.taxAmount}", "tax", "line")
  ],
  summary: [
    { key: "subtotal", kind: "text", default: "Subtotal ({order.currency})" },
    valueOf("subtotalValue", "{order.subtotal}", "subtotal"),
    { key: "addOns", kind: "text", default: "Add-Ons ({order.currency})" },
    valueOf("addOnsValue", "{order.addOns}", "addOns"),
    { key: "shipping", kind: "text", default: "Shipping ({order.currency})" },
    valueOf("shippingValue", "{order.shipping}", "shipping"),
    { key: "taxValue", kind: "value", default: "{order.tax}" },
    { key: "total", kind: "text", default: "Total ({order.currency})" },
    valueOf("totalValue", "{order.total}", "total")
  ],
  terms: [
    {
      key: "termsAndConditions",
      kind: "heading",
      default: "Terms & Conditions"
    }
  ]
} as const satisfies DocumentTextCatalog;
