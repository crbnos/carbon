// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { addressTexts, FOOTER_TEXTS } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const purchaseOrderTexts = {
  document: [
    { key: "title", kind: "heading", default: "Purchase Order" },
    { key: "documentNumber", kind: "field", default: "{order.number}" },
    ...FOOTER_TEXTS
  ],
  parties: [
    { key: "supplier", kind: "heading", default: "Supplier" },
    ...addressTexts("supplier"),
    {
      key: "supplierTaxId",
      kind: "field",
      default: "Tax ID: {supplier.taxId}"
    },
    { key: "supplierVat", kind: "field", default: "VAT: {supplier.vatNumber}" },
    { key: "supplierEori", kind: "field", default: "EORI: {supplier.eori}" },
    {
      key: "supplierContact",
      kind: "field",
      default: "Contact: {supplier.contactName}"
    },
    {
      key: "supplierEmail",
      kind: "field",
      default: "Email: {supplier.contactEmail}"
    },
    { key: "orderInfo", kind: "heading", default: "Order Info" },
    { key: "poNumber", kind: "field", default: "PO Number: {order.id}" },
    { key: "date", kind: "field", default: "Date: {order.date}" },
    { key: "currency", kind: "field", default: "Currency: {order.currency}" },
    {
      key: "reference",
      kind: "field",
      default: "Reference: {order.supplierReference}"
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
    { key: "incoterm", kind: "field", default: "Incoterm: {order.incoterm}" },
    { key: "companyVat", kind: "field", default: "VAT: {company.vatNumber}" },
    { key: "companyEori", kind: "field", default: "EORI: {company.eori}" },
    { key: "buyerContact", kind: "field", default: "Contact: {buyer.name}" },
    { key: "buyerEmail", kind: "field", default: "Email: {buyer.email}" },
    { key: "buyerPhone", kind: "field", default: "Phone: {buyer.phone}" },
    {
      key: "billingEnquiries",
      kind: "field",
      default: "Billing documents and enquiries:"
    },
    {
      key: "billingEmail",
      kind: "value",
      default: "{order.billingEmail}",
      of: "billingEnquiries"
    },
    { key: "deliverTo", kind: "heading", default: "Deliver To" },
    ...addressTexts("deliverTo")
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
    {
      key: "operationCell",
      kind: "value",
      default: "{line.operation}",
      of: "description",
      row: "line"
    },
    {
      key: "shipping",
      kind: "value",
      default: "Shipping: {line.shipping}",
      of: "description",
      row: "line"
    },
    { key: "qty", kind: "column", default: "Qty" },
    {
      key: "qtyCell",
      kind: "value",
      default: "{line.quantity}",
      of: "qty",
      row: "line"
    },
    { key: "uom", kind: "column", default: "UOM" },
    {
      key: "uomCell",
      kind: "value",
      default: "{line.unit}",
      of: "uom",
      row: "line"
    },
    { key: "required", kind: "column", default: "Required" },
    {
      key: "requiredCell",
      kind: "value",
      default: "{line.requiredDate}",
      of: "required",
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
    { key: "netValue", kind: "column", default: "Net Value" },
    {
      key: "netValueCell",
      kind: "value",
      default: "{line.netValue}",
      of: "netValue",
      row: "line"
    },
    { key: "taxValue", kind: "column", default: "Tax Value" },
    {
      key: "taxValueCell",
      kind: "value",
      default: "{line.taxAmount}",
      of: "taxValue",
      row: "line"
    },
    {
      key: "taxPercentCell",
      kind: "value",
      default: "{line.taxPercent}",
      of: "taxValue",
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
    { key: "subtotal", kind: "text", default: "Subtotal ({order.currency})" },
    {
      key: "subtotalValue",
      kind: "value",
      default: "{order.subtotal}",
      of: "subtotal"
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
