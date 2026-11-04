// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { FOOTER_TEXTS } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const purchaseOrderTexts = {
  document: [
    { key: "title", kind: "heading", default: "Purchase Order" },
    ...FOOTER_TEXTS
  ],
  parties: [
    { key: "supplier", kind: "heading", default: "Supplier" },
    { key: "supplierTaxId", kind: "field", default: "Tax ID:" },
    { key: "supplierVat", kind: "field", default: "VAT:", section: "supplier" },
    {
      key: "supplierEori",
      kind: "field",
      default: "EORI:",
      section: "supplier"
    },
    {
      key: "supplierContact",
      kind: "field",
      default: "Contact:",
      section: "supplier"
    },
    {
      key: "supplierEmail",
      kind: "field",
      default: "Email:",
      section: "supplier"
    },
    { key: "orderInfo", kind: "heading", default: "Order Info" },
    { key: "poNumber", kind: "field", default: "PO Number:" },
    { key: "date", kind: "field", default: "Date:" },
    { key: "currency", kind: "field", default: "Currency:" },
    { key: "reference", kind: "field", default: "Reference:" },
    { key: "requested", kind: "field", default: "Requested:" },
    { key: "promised", kind: "field", default: "Promised:" },
    { key: "paymentTerms", kind: "field", default: "Payment Terms:" },
    { key: "incoterm", kind: "field", default: "Incoterm:" },
    { key: "companyVat", kind: "field", default: "VAT:", section: "company" },
    { key: "companyEori", kind: "field", default: "EORI:", section: "company" },
    {
      key: "buyerContact",
      kind: "field",
      default: "Contact:",
      section: "buyer"
    },
    { key: "buyerEmail", kind: "field", default: "Email:", section: "buyer" },
    { key: "buyerPhone", kind: "field", default: "Phone:" },
    {
      key: "billingEnquiries",
      kind: "field",
      default: "Billing documents and enquiries:"
    },
    { key: "deliverTo", kind: "heading", default: "Deliver To" }
  ],
  notes: [
    { key: "notes", kind: "heading", default: "Notes" },
    { key: "none", kind: "text", default: "None" }
  ],
  lineItems: [
    { key: "number", kind: "column", default: "#" },
    { key: "description", kind: "text", default: "Description" },
    { key: "qty", kind: "column", default: "Qty" },
    { key: "uom", kind: "column", default: "UOM" },
    { key: "required", kind: "column", default: "Required" },
    { key: "unitPrice", kind: "column", default: "Unit Price" },
    { key: "netValue", kind: "column", default: "Net Value" },
    { key: "taxValue", kind: "column", default: "Tax Value" },
    { key: "total", kind: "column", default: "Total" },
    { key: "shipping", kind: "text", default: "Shipping:" }
  ],
  summary: [
    { key: "subtotal", kind: "text", default: "Subtotal" },
    { key: "shipping", kind: "text", default: "Shipping" },
    { key: "total", kind: "text", default: "Total" }
  ],
  terms: [
    {
      key: "termsAndConditions",
      kind: "heading",
      default: "Terms & Conditions"
    }
  ]
} as const satisfies DocumentTextCatalog;
