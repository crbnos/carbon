import { describe, expect, it } from "vitest";
import {
  reimbursementPaymentExternalId,
  shouldConfirmReimbursement
} from "./ramp-sync-reimbursement";

describe("Ramp reimbursement retries", () => {
  it("uses one stable synthetic payment identity across retries", () => {
    expect(reimbursementPaymentExternalId("reimb-1")).toBe(
      "reimbursement-payment:reimb-1"
    );
  });

  it("confirms manual-pay reimbursements once their invoice is posted", () => {
    expect(
      shouldConfirmReimbursement({
        invoicePosted: true,
        rampPaid: false,
        paymentStatus: null
      })
    ).toBe(true);
  });

  it.each([
    null,
    "Draft",
    "Voided"
  ] as const)("does not confirm a Ramp-paid reimbursement with payment status %s", (paymentStatus) => {
    expect(
      shouldConfirmReimbursement({
        invoicePosted: true,
        rampPaid: true,
        paymentStatus
      })
    ).toBe(false);
  });

  it("confirms a Ramp-paid reimbursement only when its payment is Posted", () => {
    expect(
      shouldConfirmReimbursement({
        invoicePosted: true,
        rampPaid: true,
        paymentStatus: "Posted"
      })
    ).toBe(true);
  });
});
