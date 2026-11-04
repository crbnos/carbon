// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { FOOTER_TEXTS } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const salesInvoiceTexts = {
  document: [
    { key: "title", kind: "heading", default: "Invoice" },
    ...FOOTER_TEXTS
  ],
  parties: [
    { key: "billTo", kind: "heading", default: "Bill To" },
    { key: "taxId", kind: "field", default: "Tax ID:" },
    { key: "vat", kind: "field", default: "VAT:" },
    { key: "eori", kind: "field", default: "EORI:" },
    { key: "contact", kind: "field", default: "Contact:" },
    { key: "email", kind: "field", default: "Email:" },
    { key: "invoiceDetails", kind: "heading", default: "Invoice Details" },
    { key: "dateIssued", kind: "field", default: "Date Issued:" },
    { key: "dueDate", kind: "field", default: "Due Date:" },
    { key: "customerRef", kind: "field", default: "Customer Ref:" },
    // One row: "Sales Order:" for one order, "Sales Orders:" for several.
    // Hiding `salesOrder` hides the row either way.
    { key: "salesOrder", kind: "field", default: "Sales Order:" },
    { key: "salesOrders", kind: "text", default: "Sales Orders:" },
    { key: "paymentTerms", kind: "field", default: "Payment Terms:" },
    { key: "shipping", kind: "field", default: "Shipping:" },
    { key: "shippingTerms", kind: "field", default: "Shipping Terms:" },
    { key: "incoterm", kind: "field", default: "Incoterm:" },
    { key: "shipTo", kind: "heading", default: "Ship To" }
  ],
  notes: [
    { key: "notes", kind: "heading", default: "Notes" },
    { key: "none", kind: "text", default: "None" }
  ],
  lineItems: [
    { key: "number", kind: "column", default: "#" },
    { key: "description", kind: "text", default: "Description" },
    { key: "qty", kind: "column", default: "Qty" },
    { key: "unitPrice", kind: "column", default: "Unit Price" },
    { key: "total", kind: "column", default: "Total" },
    { key: "taxAndFees", kind: "text", default: "Tax & Fees" },
    { key: "shipping", kind: "text", default: "- Shipping" },
    { key: "addOn", kind: "text", default: "- Add-On" },
    { key: "nonTaxableAddOn", kind: "text", default: "- Non-Taxable Add-On" },
    { key: "tax", kind: "text", default: "- Tax" }
  ],
  summary: [
    { key: "subtotal", kind: "text", default: "Subtotal" },
    { key: "discount", kind: "text", default: "Discount" },
    { key: "addOns", kind: "text", default: "Add-Ons" },
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
