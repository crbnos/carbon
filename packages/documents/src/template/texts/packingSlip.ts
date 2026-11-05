// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { addressTexts, FOOTER_TEXTS } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const packingSlipTexts = {
  document: [
    { key: "title", kind: "heading", default: "Packing Slip" },
    // The title of a rental shipment's slip.
    { key: "rentalTitle", kind: "heading", default: "Delivery Ticket" },
    { key: "documentNumber", kind: "field", default: "{shipment.number}" },
    ...FOOTER_TEXTS
  ],
  parties: [
    { key: "shipTo", kind: "heading", default: "Ship To" },
    ...addressTexts("customer"),
    { key: "shipmentDetails", kind: "heading", default: "Shipment Details" },
    { key: "date", kind: "field", default: "Date: {shipment.date}" },
    {
      key: "sourceDocument",
      kind: "field",
      default: "{shipment.sourceDocument}: {shipment.sourceDocumentId}"
    },
    {
      key: "customerPoNumber",
      kind: "field",
      default: "Customer PO #: {shipment.customerReference}"
    },
    {
      key: "tracking",
      kind: "field",
      default: "Tracking: {shipment.trackingNumber}"
    }
  ],
  details: [
    { key: "shipping", kind: "heading", default: "Shipping" },
    { key: "method", kind: "field", default: "Method: {shipment.method}" },
    { key: "payment", kind: "heading", default: "Payment" },
    { key: "terms", kind: "field", default: "Terms: {shipment.paymentTerm}" }
  ],
  lineItems: [
    { key: "description", kind: "text", default: "Description" },
    {
      key: "itemCell",
      kind: "value",
      default: "{line.item}",
      of: "description",
      row: "line"
    },
    {
      key: "descriptionCell",
      kind: "value",
      default: "{line.description}",
      of: "description",
      row: "line"
    },
    { key: "qty", kind: "column", default: "Qty" },
    {
      key: "qtyCell",
      kind: "value",
      default: "{line.shippedQuantity} / {line.orderQuantity} {line.unit}",
      of: "qty",
      row: "line"
    },
    { key: "serialBatch", kind: "column", default: "Serial/Batch" },
    {
      key: "serialBatchCell",
      kind: "value",
      default: "{line.serialBatch}",
      of: "serialBatch",
      row: "line"
    },
    // A rental shipment lists its units in a table of its own.
    {
      key: "rentalDescription",
      kind: "text",
      default: "Description",
      section: "rental"
    },
    {
      key: "rentalNameCell",
      kind: "value",
      default: "{unit.name}",
      of: "rentalDescription",
      row: "unit"
    },
    {
      key: "rentalAssetCell",
      kind: "value",
      default: "{unit.assetId}",
      of: "rentalDescription",
      row: "unit"
    },
    { key: "rentalQty", kind: "column", default: "Qty", section: "rental" },
    {
      key: "rentalQtyCell",
      kind: "value",
      default: "{unit.quantity}",
      of: "rentalQty",
      row: "unit"
    },
    { key: "serial", kind: "column", default: "Serial" },
    {
      key: "serialCell",
      kind: "value",
      default: "{unit.serial}",
      of: "serial",
      row: "unit"
    }
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
