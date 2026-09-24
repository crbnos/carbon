import { describe, expect, it } from "vitest";
import {
  buildRampReimbursementPayout,
  extractRampUser,
  hasRecordedPayout,
  RAMP_REIMBURSEMENT_ENTITY_TYPE,
  reimbursementPaymentExternalId
} from "./ramp-sync-reimbursement";

describe("Ramp reimbursement identity", () => {
  it("uses one stable synthetic payment identity across retries", () => {
    expect(reimbursementPaymentExternalId("reimb-1")).toBe(
      "reimbursement-payment:reimb-1"
    );
  });

  it("keys the mapping on the reimbursement document, not the bill id space", () => {
    // The ERP's reimbursement loader reads this exact entity type to render the
    // SOURCE badge's external id. `"bill"` was the purchase-invoice era.
    expect(RAMP_REIMBURSEMENT_ENTITY_TYPE).toBe("reimbursement");
  });

  it("reads the Ramp user from either the embed or the flat id", () => {
    expect(
      extractRampUser({
        id: "r1",
        user: { user_id: "u1", email: "Ada@Example.com" }
      })
    ).toMatchObject({ user_id: "u1", email: "Ada@Example.com" });
    expect(extractRampUser({ id: "r1", user_id: "u2" })).toMatchObject({
      user_id: "u2"
    });
    expect(extractRampUser({ id: "r1" })).toBeNull();
  });
});

describe("Ramp-paid reimbursement payout intent", () => {
  const base = {
    rampReimbursementId: "reimb-1",
    bankAccountId: "bank-1",
    paidAt: "2026-09-12T10:00:00Z",
    amount: 125.5,
    currencyCode: "EUR",
    exchangeRate: 0.91
  };

  it("carries the IMPORT-time exchange rate so Post never re-derives one", () => {
    const built = buildRampReimbursementPayout(base);
    expect(built).toEqual({
      ok: true,
      value: {
        rampPaymentId: "reimbursement-payment:reimb-1",
        paidAt: "2026-09-12",
        bankAccountId: "bank-1",
        amount: 125.5,
        currencyCode: "EUR",
        exchangeRate: 0.91
      }
    });
  });

  it.each([
    { bankAccountId: null },
    { paidAt: null },
    { amount: 0 },
    { amount: null },
    { exchangeRate: 0 }
  ])("refuses an unusable payout %j", (change) => {
    const built = buildRampReimbursementPayout({ ...base, ...change });
    expect(built.ok).toBe(false);
  });
});

describe("hasRecordedPayout", () => {
  // The predicate that decides whether a re-sync records a payout intent onto
  // an already-mapped reimbursement. Getting it wrong in either direction is a
  // money bug: too eager overwrites the FX snapshot of the payout that really
  // happened, too shy leaves a paid reimbursement permanently unsettleable.
  it("recognises a recorded payout by its rampPaymentId", () => {
    expect(
      hasRecordedPayout({
        rampPaymentId: "reimbursement-payment:reimb-1",
        paidAt: "2026-09-12",
        bankAccountId: "bank-1",
        amount: 125.5,
        currencyCode: "EUR",
        exchangeRate: 0.91
      })
    ).toBe(true);
  });

  it.each([
    ["no metadata at all", null],
    ["an empty bag", {}],
    ["receipt/deep-link keys only", { receiptUrl: "https://ramp.test/r/1" }],
    ["a non-string rampPaymentId", { rampPaymentId: 42 }],
    ["a JSON string rather than an object", '{"rampPaymentId":"x"}']
  ])("treats %s as NOT recorded", (_label, metadata) => {
    expect(hasRecordedPayout(metadata)).toBe(false);
  });
});
