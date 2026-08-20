import { describe, expect, it } from "vitest";
import type { EdiInvoicePayload } from "../../types";
import {
  fromCanonical,
  type OrderfulTransaction,
  parseOrderfulWebhook,
  toCanonicalOrder
} from "./mapper";

const orderFixture: OrderfulTransaction = {
  transactionId: "txn-1",
  transactionType: "850",
  partnerId: "partner-1",
  content: {
    purchaseOrderNumber: "PO-1",
    orderDate: "2026-08-04",
    requestedShipDate: "2026-08-10",
    shipTo: { locationCode: "DC-001", name: "Main DC" },
    lineItems: [
      {
        lineNumber: "1",
        buyerPartNumber: "WIDGET-42",
        revision: "B",
        quantity: 10,
        unitOfMeasure: "EA",
        unitPrice: 5
      }
    ]
  }
};

describe("toCanonicalOrder", () => {
  it("maps an Orderful 850 to the canonical order payload", () => {
    const { documentType, payload } = toCanonicalOrder(orderFixture);
    expect(documentType).toBe("Purchase Order");
    expect(payload.partnerReference).toBe("PO-1");
    expect(payload.shipTo.code).toBe("DC-001");
    expect(payload.lines).toEqual([
      {
        partnerLineNumber: "1",
        partnerPartId: "WIDGET-42",
        partnerPartRevision: "B",
        quantity: 10,
        unitOfMeasure: "EA",
        unitPrice: 5,
        requestedDate: undefined
      }
    ]);
  });
});

describe("parseOrderfulWebhook", () => {
  it("parses an embedded 850 transaction with its payload", () => {
    const parsed = parseOrderfulWebhook(orderFixture);
    expect(parsed?.kind).toBe("transaction");
    if (parsed?.kind === "transaction") {
      expect(parsed.externalId).toBe("txn-1");
      expect(parsed.documentType).toBe("Purchase Order");
      expect(parsed.payload?.partnerReference).toBe("PO-1");
    }
  });

  it("parses a 997 acknowledgment", () => {
    const parsed = parseOrderfulWebhook({
      transactionId: "ack-1",
      transactionType: "997",
      acknowledgedTransactionId: "txn-out-1",
      acknowledgmentStatus: "rejected",
      errors: ["ST segment invalid"]
    });
    expect(parsed?.kind).toBe("acknowledgment");
    if (parsed?.kind === "acknowledgment") {
      expect(parsed.externalId).toBe("txn-out-1");
      expect(parsed.accepted).toBe(false);
      expect(parsed.reasons).toEqual(["ST segment invalid"]);
    }
  });

  it("returns null on an unknown transaction type", () => {
    expect(
      parseOrderfulWebhook({ transactionId: "x", transactionType: "999" })
    ).toBeNull();
  });

  it("returns null on a malformed body", () => {
    expect(parseOrderfulWebhook(null)).toBeNull();
    expect(parseOrderfulWebhook({ transactionType: "850" })).toBeNull();
  });
});

describe("fromCanonical", () => {
  it("maps a canonical invoice to an Orderful 810 body, lossless for mapped fields", () => {
    const invoice: EdiInvoicePayload = {
      partnerReference: "PO-1",
      invoiceNumber: "INV-1",
      invoiceDate: "2026-08-04",
      currencyCode: "USD",
      lines: [
        {
          partnerPartId: "WIDGET-42",
          quantity: 2,
          unitOfMeasure: "EA",
          unitPrice: 5
        }
      ],
      total: 10
    };
    const body = fromCanonical("Invoice", invoice);
    expect(body.transactionType).toBe("810");
    expect(body.content).toEqual(invoice);
  });
});
