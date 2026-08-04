import { describe, expect, it } from "vitest";
import {
  buildAckPayload,
  buildInvoicePayload,
  buildShipNoticePayload
} from "./build";

describe("buildAckPayload", () => {
  it("builds an accept-as-is ack from the buyer PO number", () => {
    const { payload, issues } = buildAckPayload({
      salesOrder: { customerReference: "PO-1" }
    });
    expect(issues).toHaveLength(0);
    expect(payload).toEqual({ partnerReference: "PO-1", accepted: true });
  });

  it("returns a missing-reference issue when there is no buyer PO number", () => {
    const { payload, issues } = buildAckPayload({
      salesOrder: { customerReference: null }
    });
    expect(payload).toBeNull();
    expect(issues[0]?.code).toBe("missing-reference");
  });
});

describe("buildShipNoticePayload", () => {
  it("builds an ASN with buyer parts and shipped quantities", () => {
    const { payload, issues } = buildShipNoticePayload({
      shipment: {
        partnerReference: "PO-1",
        shipDate: "2026-08-04",
        trackingNumber: "1Z999",
        shipVia: "UPSN"
      },
      shipmentLines: [{ itemId: "item-1", quantity: 5, unitOfMeasure: "EA" }],
      partNumbersByItemId: { "item-1": "WIDGET-42" }
    });
    expect(issues).toHaveLength(0);
    expect(payload).toEqual({
      partnerReference: "PO-1",
      shipDate: "2026-08-04",
      trackingNumber: "1Z999",
      shipVia: "UPSN",
      lines: [{ partnerPartId: "WIDGET-42", quantity: 5, unitOfMeasure: "EA" }]
    });
  });

  it("returns a missing-reference issue when the source order has no buyer PO number", () => {
    const { payload, issues } = buildShipNoticePayload({
      shipment: { partnerReference: null, shipDate: "2026-08-04" },
      shipmentLines: [{ itemId: "item-1", quantity: 5, unitOfMeasure: "EA" }],
      partNumbersByItemId: { "item-1": "WIDGET-42" }
    });
    expect(payload).toBeNull();
    expect(issues.some((i) => i.code === "missing-reference")).toBe(true);
  });

  it("returns an unknown-part issue for an unmapped item", () => {
    const { payload, issues } = buildShipNoticePayload({
      shipment: { partnerReference: "PO-1", shipDate: "2026-08-04" },
      shipmentLines: [{ itemId: "item-1", quantity: 5, unitOfMeasure: "EA" }],
      partNumbersByItemId: {}
    });
    expect(payload).toBeNull();
    expect(issues[0]?.code).toBe("unknown-part");
  });
});

describe("buildInvoicePayload", () => {
  it("builds an invoice with a computed total", () => {
    const { payload, issues } = buildInvoicePayload({
      salesInvoice: {
        partnerReference: "PO-1",
        invoiceNumber: "INV-1",
        invoiceDate: "2026-08-04",
        currencyCode: "USD"
      },
      salesInvoiceLines: [
        { itemId: "item-1", quantity: 2, unitOfMeasure: "EA", unitPrice: 5 },
        { itemId: "item-2", quantity: 3, unitOfMeasure: "EA", unitPrice: 10 }
      ],
      partNumbersByItemId: { "item-1": "W-1", "item-2": "W-2" }
    });
    expect(issues).toHaveLength(0);
    expect(payload?.total).toBe(40);
    expect(payload?.lines).toHaveLength(2);
  });

  it("returns a missing-reference issue when there is no buyer PO number", () => {
    const { payload, issues } = buildInvoicePayload({
      salesInvoice: {
        partnerReference: null,
        invoiceNumber: "INV-1",
        invoiceDate: "2026-08-04",
        currencyCode: "USD"
      },
      salesInvoiceLines: [],
      partNumbersByItemId: {}
    });
    expect(payload).toBeNull();
    expect(issues[0]?.code).toBe("missing-reference");
  });
});
