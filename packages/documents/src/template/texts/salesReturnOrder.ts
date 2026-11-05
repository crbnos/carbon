// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { addressTexts, FOOTER_TEXTS } from "./shared";
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
    {
      key: "numberCell",
      kind: "value",
      default: "{line.number}",
      of: "number",
      row: "line"
    },
    { key: "item", kind: "text", default: "Item" },
    {
      key: "itemCell",
      kind: "value",
      default: "{line.itemId}",
      of: "item",
      row: "line"
    },
    {
      key: "itemNameCell",
      kind: "value",
      default: "{line.itemName}",
      of: "item",
      row: "line"
    },
    { key: "qtyAuthorized", kind: "column", default: "Qty Authorized" },
    {
      key: "qtyAuthorizedCell",
      kind: "value",
      default: "{line.quantity} {line.unit}",
      of: "qtyAuthorized",
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
    { key: "reason", kind: "column", default: "Reason" },
    {
      key: "reasonCell",
      kind: "value",
      default: "{line.reason}",
      of: "reason",
      row: "line"
    },
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
