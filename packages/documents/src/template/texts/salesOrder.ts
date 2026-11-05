// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { addressTexts, FOOTER_TEXTS } from "./shared";
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
    { key: "total", kind: "column", default: "Total" },
    {
      key: "totalCell",
      kind: "value",
      default: "{line.total}",
      of: "total",
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
    }
  ],
  summary: [
    { key: "subtotal", kind: "text", default: "Subtotal ({order.currency})" },
    {
      key: "subtotalValue",
      kind: "value",
      default: "{order.subtotal}",
      of: "subtotal"
    },
    { key: "addOns", kind: "text", default: "Add-Ons ({order.currency})" },
    {
      key: "addOnsValue",
      kind: "value",
      default: "{order.addOns}",
      of: "addOns"
    },
    { key: "shipping", kind: "text", default: "Shipping ({order.currency})" },
    {
      key: "shippingValue",
      kind: "value",
      default: "{order.shipping}",
      of: "shipping"
    },
    { key: "taxValue", kind: "value", default: "{order.tax}" },
    { key: "total", kind: "text", default: "Total ({order.currency})" },
    {
      key: "totalValue",
      kind: "value",
      default: "{order.total}",
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
