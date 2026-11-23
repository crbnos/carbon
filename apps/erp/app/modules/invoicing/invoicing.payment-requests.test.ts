// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  canTransitionPaymentRequest,
  type PaymentRequestStatus,
  paymentRequestStatusTypes,
  paymentRequestValidator
} from "./invoicing.models";

// The spec's "Status lifecycle", transitions 1 to 7.
const allowed: [PaymentRequestStatus, PaymentRequestStatus][] = [
  ["Planned", "Ready"],
  ["Ready", "Planned"],
  ["Ready", "Sent"],
  ["Sent", "Paid"],
  ["Planned", "Cancelled"],
  ["Ready", "Cancelled"],
  ["Sent", "Cancelled"],
  ["Planned", "Paid"],
  ["Ready", "Paid"],
  ["Cancelled", "Paid"]
];

describe("payment request lifecycle", () => {
  it.each(allowed)("allows %s to %s", (from, to) => {
    expect(canTransitionPaymentRequest(from, to)).toBe(true);
  });

  const key = (from: string, to: string) => `${from}>${to}`;
  const allowedKeys = new Set(allowed.map(([f, t]) => key(f, t)));
  const refused = paymentRequestStatusTypes.flatMap((from) =>
    paymentRequestStatusTypes
      .filter((to) => to !== from && !allowedKeys.has(key(from, to)))
      .map((to) => [from, to] as const)
  );

  it.each(refused)("refuses %s to %s", (from, to) => {
    expect(canTransitionPaymentRequest(from, to)).toBe(false);
  });

  it("leaves Paid final", () => {
    for (const to of paymentRequestStatusTypes) {
      expect(canTransitionPaymentRequest("Paid", to)).toBe(false);
    }
  });
});

describe("paymentRequestValidator", () => {
  it("needs exactly one target", () => {
    expect(
      paymentRequestValidator.safeParse({ status: "Planned" }).success
    ).toBe(false);
    expect(
      paymentRequestValidator.safeParse({
        purchaseInvoiceId: "a",
        purchaseOrderId: "b"
      }).success
    ).toBe(false);
  });

  it("lets a Planned request have no amount or date", () => {
    expect(
      paymentRequestValidator.safeParse({ purchaseInvoiceId: "a" }).success
    ).toBe(true);
  });

  it("needs an amount and a due date when Ready", () => {
    expect(
      paymentRequestValidator.safeParse({
        purchaseInvoiceId: "a",
        status: "Ready",
        amount: 20000
      }).success
    ).toBe(false);
    expect(
      paymentRequestValidator.safeParse({
        purchaseInvoiceId: "a",
        status: "Ready",
        amount: 20000,
        dueDate: "2026-12-01"
      }).success
    ).toBe(true);
  });
});
