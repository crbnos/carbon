import { describe, expect, it } from "vitest";
import {
  buildRampReimbursementPayout,
  extractRampUser,
  hasRecordedPayout,
  RAMP_REIMBURSEMENT_ENTITY_TYPE,
  reimbursementHeaderAmount,
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

describe("extractRampUser reads Ramp's real payload shape", () => {
  // Ramp sends the employee identity at the TOP LEVEL and `user: null`. Reading
  // only the nested object made every reimbursement fail "cannot match a Carbon
  // employee" while the address sat in the payload — live-confirmed 2026-09-24.
  it("takes user_email / user_full_name from the top level", () => {
    const extracted = extractRampUser({
      id: "reimb_1",
      user_id: "55671050-ea35-4d1b-a355-f03674cd94d2",
      user: null,
      user_email: "brad@carbon.ms",
      user_full_name: "Brad Barbin"
    } as never);
    expect(extracted).toEqual({
      user_id: "55671050-ea35-4d1b-a355-f03674cd94d2",
      first_name: "Brad",
      last_name: "Barbin",
      email: "brad@carbon.ms"
    });
  });

  it("still prefers a nested user object when Ramp sends one", () => {
    const extracted = extractRampUser({
      id: "reimb_2",
      user_id: "u2",
      user: {
        email: "nested@carbon.ms",
        first_name: "Nested",
        last_name: "User"
      },
      user_email: "toplevel@carbon.ms"
    } as never);
    expect(extracted?.email).toBe("nested@carbon.ms");
    expect(extracted?.first_name).toBe("Nested");
  });

  it("returns null email when neither is present", () => {
    const extracted = extractRampUser({ id: "r3", user_id: "u3" } as never);
    expect(extracted?.email).toBeNull();
  });
});

describe("reimbursementHeaderAmount reads Ramp's real amount shape", () => {
  // A live reimbursement's top-level `amount` is a bare number in MAJOR units
  // (1000 for $1,000.00) while the verified minor-unit objects carry 100000.
  // Passing the bare number to the verified-minor normalizer rejected EVERY
  // reimbursement with "ambiguous bare-number amount" — live-confirmed
  // 2026-09-24, the same payload that exposed the top-level `user_email`.
  const live = {
    id: "reimb_1",
    amount: 1000,
    entity_amount: { value: 100000, currency: "USD" },
    payee_amount: { amount: 100000, currency_code: "USD" },
    original_reimbursement_amount: { amount: 100000, currency_code: "USD" }
  } as never;

  it("prefers the entity settlement amount over the deprecated bare number", () => {
    expect(reimbursementHeaderAmount(live)).toEqual({
      value: 100000,
      currency: "USD"
    });
  });

  it("falls back to the payee amount, then the submitted amount", () => {
    expect(
      reimbursementHeaderAmount({
        id: "reimb_2",
        amount: 1000,
        payee_amount: { amount: 100000, currency_code: "USD" },
        original_reimbursement_amount: { amount: 99000, currency_code: "USD" }
      } as never)
    ).toEqual({ amount: 100000, currency_code: "USD" });
    expect(
      reimbursementHeaderAmount({
        id: "reimb_3",
        amount: 1000,
        original_reimbursement_amount: { amount: 99000, currency_code: "USD" }
      } as never)
    ).toEqual({ amount: 99000, currency_code: "USD" });
  });

  it("hands back the bare amount when no verified object exists, so the normalizer refuses it", () => {
    // Deliberate: a number whose units cannot be verified must fail loudly
    // rather than post a document that is wrong by 100x.
    expect(
      reimbursementHeaderAmount({ id: "reimb_4", amount: 1000 } as never)
    ).toBe(1000);
  });
});
