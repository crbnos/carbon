// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { addressTexts, cell, FOOTER_TEXTS, valueOf } from "./shared";
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
    valueOf("billingEmail", "{order.billingEmail}", "billingEnquiries"),
    { key: "deliverTo", kind: "heading", default: "Deliver To" },
    ...addressTexts("deliverTo")
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
    cell(
      "supplierPartCell",
      "Supplier Part ID: {line.supplierPartId}",
      "description",
      "line"
    ),
    cell("operationCell", "{line.operation}", "description", "line"),
    cell("shipping", "Shipping: {line.shipping}", "description", "line"),
    { key: "qty", kind: "column", default: "Qty" },
    cell("qtyCell", "{line.quantity}", "qty", "line"),
    { key: "uom", kind: "column", default: "UOM" },
    cell("uomCell", "{line.unit}", "uom", "line"),
    { key: "required", kind: "column", default: "Required" },
    cell("requiredCell", "{line.requiredDate}", "required", "line"),
    { key: "unitPrice", kind: "column", default: "Unit Price" },
    cell("unitPriceCell", "{line.unitPrice}", "unitPrice", "line"),
    { key: "netValue", kind: "column", default: "Net Value" },
    cell("netValueCell", "{line.netValue}", "netValue", "line"),
    { key: "taxValue", kind: "column", default: "Tax Value" },
    cell("taxValueCell", "{line.taxAmount}", "taxValue", "line"),
    cell("taxPercentCell", "{line.taxPercent}", "taxValue", "line"),
    { key: "total", kind: "column", default: "Total" },
    cell("totalCell", "{line.total}", "total", "line")
  ],
  summary: [
    { key: "subtotal", kind: "text", default: "Subtotal ({order.currency})" },
    valueOf("subtotalValue", "{order.subtotal}", "subtotal"),
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
