// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { addressTexts, cell, FOOTER_TEXTS, valueOf } from "./shared";
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
