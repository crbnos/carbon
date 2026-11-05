// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { addressTexts, FOOTER_TEXTS } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const purchaseReturnOrderTexts = {
  document: [
    { key: "title", kind: "heading", default: "Return to Supplier" },
    { key: "documentNumber", kind: "field", default: "{order.number}" },
    // The supplier's RMA number under the document id.
    {
      key: "supplierRmaNumber",
      kind: "field",
      default: "Supplier RMA #: {order.supplierReference}"
    },
    ...FOOTER_TEXTS
  ],
  parties: [
    { key: "returnTo", kind: "heading", default: "Return To" },
    ...addressTexts("supplier"),
    { key: "returnDetails", kind: "heading", default: "Return Details" },
    {
      key: "returnNumber",
      kind: "field",
      default: "Return Number: {order.number}"
    },
    {
      key: "supplierRmaNumber",
      kind: "field",
      default: "Supplier RMA #: {order.supplierReference}"
    },
    { key: "date", kind: "field", default: "Date: {order.date}" },
    {
      key: "expires",
      kind: "field",
      default: "Expires: {order.expirationDate}"
    },
    { key: "shipFrom", kind: "heading", default: "Ship From" },
    ...addressTexts("shipFrom")
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
