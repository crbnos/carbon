// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { FOOTER_TEXTS } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const packingSlipTexts = {
  document: [
    { key: "title", kind: "heading", default: "Packing Slip" },
    // The title of a rental shipment's slip.
    { key: "rentalTitle", kind: "heading", default: "Delivery Ticket" },
    ...FOOTER_TEXTS
  ],
  parties: [
    { key: "shipTo", kind: "heading", default: "Ship To" },
    { key: "shipmentDetails", kind: "heading", default: "Shipment Details" },
    { key: "date", kind: "field", default: "Date:" },
    { key: "customerPoNumber", kind: "field", default: "Customer PO #:" },
    { key: "tracking", kind: "field", default: "Tracking:" }
  ],
  details: [
    { key: "shipping", kind: "heading", default: "Shipping" },
    { key: "method", kind: "field", default: "Method:" },
    { key: "payment", kind: "heading", default: "Payment" },
    { key: "terms", kind: "field", default: "Terms:" }
  ],
  lineItems: [
    { key: "description", kind: "text", default: "Description" },
    { key: "qty", kind: "column", default: "Qty" },
    { key: "serialBatch", kind: "column", default: "Serial/Batch" },
    // A rental shipment lists its units in a table of its own.
    {
      key: "rentalDescription",
      kind: "text",
      default: "Description",
      section: "rental"
    },
    { key: "rentalQty", kind: "column", default: "Qty", section: "rental" },
    { key: "serial", kind: "column", default: "Serial" }
  ],
  notes: [{ key: "notes", kind: "heading", default: "Notes" }],
  terms: [
    {
      key: "standardTermsAndConditions",
      kind: "heading",
      default: "Standard Terms & Conditions"
    }
  ]
} as const satisfies DocumentTextCatalog;
