// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { addressTexts, cell, FOOTER_TEXTS, valueOf } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const salesReturnOrderTexts = {
  document: [
    {
      key: "title",
      kind: "heading",
      default: "Return Merchandise Authorization"
    },
    { key: "documentNumber", kind: "field", default: "{order.number}" },
    ...FOOTER_TEXTS
  ],
  parties: [
    { key: "customer", kind: "heading", default: "Customer" },
    ...addressTexts("customer"),
    { key: "returnDetails", kind: "heading", default: "Return Details" },
    { key: "rmaNumber", kind: "field", default: "RMA Number: {order.number}" },
    { key: "date", kind: "field", default: "Date: {order.date}" },
    {
      key: "expires",
      kind: "field",
      default: "Expires: {order.expirationDate}"
    },
    {
      key: "customerRef",
      kind: "field",
      default: "Customer Ref: {order.customerReference}"
    },
    { key: "returnTo", kind: "heading", default: "Return To" },
    ...addressTexts("returnTo")
  ],
  notes: [
    { key: "notes", kind: "heading", default: "Notes" },
    { key: "none", kind: "text", default: "None" }
  ],
  lineItems: [
    { key: "number", kind: "column", default: "#" },
    cell("numberCell", "{line.number}", "number", "line"),
    { key: "item", kind: "text", default: "Item" },
    cell("itemCell", "{line.itemId}", "item", "line"),
    cell("itemNameCell", "{line.itemName}", "item", "line"),
    { key: "qtyAuthorized", kind: "column", default: "Qty Authorized" },
    cell(
      "qtyAuthorizedCell",
      "{line.quantity} {line.unit}",
      "qtyAuthorized",
      "line"
    ),
    { key: "unitPrice", kind: "column", default: "Unit Price" },
    cell("unitPriceCell", "{line.unitPrice}", "unitPrice", "line"),
    { key: "reason", kind: "column", default: "Reason" },
    cell("reasonCell", "{line.reason}", "reason", "line"),
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
