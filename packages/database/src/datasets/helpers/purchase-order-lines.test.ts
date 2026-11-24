// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { satellite } from "../data/satellite/index.ts";
import { DATASETS } from "../index.ts";
import type {
  Dataset,
  PurchaseInvoiceSpec,
  PurchaseOrderSpec,
  ReceiptSpec
} from "../types.ts";
import { validateDataset } from "../validate.ts";
import {
  derivedPurchaseOrderStatus,
  purchaseOrderLineCounts
} from "./purchase-order-lines.ts";

type DirectOrder = Extract<PurchaseOrderSpec, { source: "direct" }>;

const order = (patch: Partial<DirectOrder> = {}): DirectOrder => ({
  source: "direct",
  log: "purchase order — test",
  supplier: "CelestialElex",
  purchaseOrderType: "Purchase",
  status: "To Receive and Invoice",
  orderDateOffset: -30,
  lines: [
    { item: "PCB-BARE-REV3", purchaseQuantity: 10, supplierUnitPrice: 85 },
    { item: "BAT-LIION-48V", purchaseQuantity: 2, supplierUnitPrice: 2380 }
  ],
  ...patch
});

const receipt = (
  status: string,
  received: Record<string, number>
): ReceiptSpec => ({
  ref: "receipt:test",
  status,
  postedOffset: status === "Posted" ? -20 : undefined,
  lines: Object.entries(received).map(([item, receivedQuantity]) => ({
    item,
    orderQuantity: receivedQuantity,
    outstandingQuantity: 0,
    receivedQuantity,
    unitPrice: 1,
    toShelf: "A1-L1"
  }))
});

const invoice = (
  status: string,
  invoiced: Record<string, number>
): PurchaseInvoiceSpec => ({
  ref: "pinvoice:test",
  status,
  currencyCode: "USD",
  subtotal: 0,
  totalAmount: 0,
  dateIssuedOffset: -10,
  lines: Object.entries(invoiced).map(([item, quantity]) => ({
    item,
    quantity,
    supplierUnitPrice: 0
  }))
});

const FULL = { "PCB-BARE-REV3": 10, "BAT-LIION-48V": 2 };

describe("purchaseOrderLineCounts", () => {
  it("counts a Posted receipt and a posted invoice per line", () => {
    const counts = purchaseOrderLineCounts(
      order({
        receipt: receipt("Posted", { "PCB-BARE-REV3": 4 }),
        invoice: invoice("Open", { "BAT-LIION-48V": 2 })
      })
    );
    expect(counts["PCB-BARE-REV3"]).toEqual({
      quantityReceived: 4,
      receivedComplete: false,
      quantityInvoiced: 0,
      invoicedComplete: false
    });
    expect(counts["BAT-LIION-48V"]).toEqual({
      quantityReceived: 0,
      receivedComplete: false,
      quantityInvoiced: 2,
      invoicedComplete: true
    });
  });

  it("counts nothing from a Draft or Voided receipt or invoice", () => {
    for (const status of ["Draft", "Voided"]) {
      const counts = purchaseOrderLineCounts(
        order({
          receipt: receipt(status, FULL),
          invoice: invoice(status, FULL)
        })
      );
      for (const line of Object.values(counts)) {
        expect(line.quantityReceived).toBe(0);
        expect(line.quantityInvoiced).toBe(0);
      }
    }
  });
});

describe("derivedPurchaseOrderStatus", () => {
  it.each([
    ["nothing posted", {}, "To Receive and Invoice"],
    ["received in full", { receipt: receipt("Posted", FULL) }, "To Invoice"],
    ["invoiced in full", { invoice: invoice("Paid", FULL) }, "To Receive"],
    [
      "received and invoiced in full",
      { receipt: receipt("Posted", FULL), invoice: invoice("Overdue", FULL) },
      "Completed"
    ],
    [
      "one line received short",
      { receipt: receipt("Posted", { ...FULL, "BAT-LIION-48V": 1 }) },
      "To Receive and Invoice"
    ]
  ] as const)("%s", (_label, patch, status) => {
    expect(derivedPurchaseOrderStatus(order(patch))).toBe(status);
  });

  it("reads a winning-quote order as nothing posted", () => {
    expect(
      derivedPurchaseOrderStatus({
        source: "winningQuote",
        log: "purchase order — test",
        purchaseOrderType: "Purchase",
        status: "Completed",
        orderDateOffset: -8,
        currencyCode: "USD",
        exchangeRate: 1
      })
    ).toBe("To Receive and Invoice");
  });
});

describe("the purchasing rule", () => {
  const paidIndex = satellite.purchasing.purchaseOrders.findIndex(
    (po) => po.source === "direct" && po.ref === "po:paid"
  );
  const withPaidOrder = (patch: Partial<DirectOrder>): Dataset => ({
    ...satellite,
    purchasing: {
      ...satellite.purchasing,
      purchaseOrders: satellite.purchasing.purchaseOrders.map((po, index) =>
        index === paidIndex ? { ...(po as DirectOrder), ...patch } : po
      )
    }
  });
  const statusViolations = (dataset: Dataset) =>
    validateDataset(dataset).filter((v) =>
      v.includes("its receipt and invoice make it")
    );

  it.each(Object.keys(DATASETS))("accepts %s's order statuses", (key) => {
    expect(statusViolations(DATASETS[key as keyof typeof DATASETS])).toEqual(
      []
    );
  });

  it("refuses a Completed order that was never received", () => {
    const violations = statusViolations(withPaidOrder({ receipt: undefined }));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(`purchaseOrders[${paidIndex}]`);
    expect(violations[0]).toContain('make it "To Receive"');
  });

  it("leaves a hand-set status alone", () => {
    expect(
      statusViolations(withPaidOrder({ status: "Closed", receipt: undefined }))
    ).toEqual([]);
  });
});
