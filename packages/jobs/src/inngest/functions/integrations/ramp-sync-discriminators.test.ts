// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Ramp's enum-like fields, read against its OpenAPI contract (2026-09-11). A
// value Carbon has not verified must fail the item, never post a guess.
import { describe, expect, it } from "vitest";
import { rampBillPaymentRoute } from "./ramp-sync-payment";
import {
  mappedReimbursementNeedsPayout,
  rampReimbursementStateKind
} from "./ramp-sync-reimbursement";
import { isVerifiedRepaymentFunding } from "./ramp-sync-repayment";

describe("rampBillPaymentRoute", () => {
  it.each([
    "ACH",
    "CHECK",
    "DIRECT_DEBIT",
    "DOMESTIC_WIRE",
    "FED_NOW",
    "INTERNATIONAL",
    "LOCAL_BANK_TRANSFER",
    "RTP",
    "SWIFT"
  ])("posts bank method %s as a payment", (method) => {
    expect(rampBillPaymentRoute(method)).toBe("bank");
  });

  it.each([
    "CARD",
    "ONE_TIME_CARD",
    "ONE_TIME_CARD_DELIVERY",
    "AUTOMATIC_CARD_PAYMENT"
  ])("leaves card method %s to the card charge sync", (method) => {
    expect(rampBillPaymentRoute(method)).toBe("card");
  });

  it.each([
    undefined,
    null,
    "",
    "ach",
    "NEW_PAYMENT_RAIL",
    "VENDOR_CREDIT",
    "PAID_MANUALLY",
    "UNSPECIFIED"
  ])("refuses unverified method %s", (method) => {
    expect(rampBillPaymentRoute(method)).toBe("unsupported");
  });
});

describe("rampReimbursementStateKind", () => {
  it.each([
    ["REIMBURSED", "paid"],
    ["REIMBURSED_VIA_PUSH", "paid"],
    ["APPROVED", "invoiceOnly"],
    ["AWAITING_PAYMENT", "invoiceOnly"],
    ["AWAITING_PUSH_PAYMENT", "invoiceOnly"],
    ["MANUALLY_REIMBURSED", "invoiceOnly"],
    [undefined, "unsupported"],
    ["", "unsupported"],
    ["NEW_STATE", "unsupported"],
    ["PAID", "unsupported"],
    ["PAID_OUT", "unsupported"],
    ["REJECTED", "unsupported"],
    ["DELETED", "unsupported"]
  ] as const)("reads state %s as %s", (state, kind) => {
    expect(rampReimbursementStateKind(state)).toBe(kind);
  });
});

describe("mappedReimbursementNeedsPayout", () => {
  const recorded = {
    rampPaymentId: "reimbursement-payment:r-1",
    exchangeRate: 0.91
  };

  it("records the payout on an imported reimbursement Ramp has since paid", () => {
    // Without it Post never settles the money Ramp already moved.
    expect(mappedReimbursementNeedsPayout("paid", null)).toBe(true);
  });

  it("keeps the first recorded payout on the next pass", () => {
    expect(mappedReimbursementNeedsPayout("paid", recorded)).toBe(false);
  });

  it("records nothing while the reimbursement is unpaid", () => {
    expect(mappedReimbursementNeedsPayout("invoiceOnly", null)).toBe(false);
  });
});

describe("isVerifiedRepaymentFunding", () => {
  it("accepts ach, the only funding Ramp documents", () => {
    expect(isVerifiedRepaymentFunding("ach")).toBe(true);
  });

  it.each([undefined, null, "", "ACH", "NEW_FUNDING", "STATEMENT_CREDIT"])(
    "refuses funding %s",
    (method) => {
      expect(isVerifiedRepaymentFunding(method)).toBe(false);
    }
  );
});
