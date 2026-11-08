// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { addressTexts, cell, FOOTER_TEXTS } from "./shared";
import type { DocumentTextCatalog } from "./types";

export const packingSlipTexts = {
  document: [
    { key: "title", kind: "heading", default: "Packing Slip" },
    { key: "documentNumber", kind: "field", default: "{shipment.number}" },
    // The title of a rental shipment's slip.
    { key: "rentalTitle", kind: "heading", default: "Delivery Ticket" },
    // The title of a contract delivery's slip.
    {
      key: "receivingReportTitle",
      kind: "heading",
      default: "Receiving Report"
    },
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
    // The same reference on a Receiving Report.
    {
      key: "contractNumber",
      kind: "field",
      default: "Contract No.: {shipment.customerReference}"
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
    cell("itemCell", "{line.item}", "description", "line"),
    cell("descriptionCell", "{line.description}", "description", "line"),
    { key: "qty", kind: "column", default: "Qty" },
    cell(
      "qtyCell",
      "{line.shippedQuantity} / {line.orderQuantity} {line.unit}",
      "qty",
      "line"
    ),
    { key: "serialBatch", kind: "column", default: "Serial/Batch" },
    cell("serialBatchCell", "{line.serialBatch}", "serialBatch", "line"),
    // A rental shipment lists its units in a table of its own.
    {
      key: "rentalDescription",
      kind: "text",
      default: "Description",
      section: "rental"
    },
    cell("rentalNameCell", "{unit.name}", "rentalDescription", "unit"),
    cell("rentalAssetCell", "{unit.assetId}", "rentalDescription", "unit"),
    { key: "rentalQty", kind: "column", default: "Qty", section: "rental" },
    cell("rentalQtyCell", "{unit.quantity}", "rentalQty", "unit"),
    { key: "serial", kind: "column", default: "Serial" },
    cell("serialCell", "{unit.serial}", "serial", "unit")
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
