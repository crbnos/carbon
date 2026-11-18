// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";
import {
  assertNoLegacyUntrackedPayment,
  ensureRampPaymentPosted,
  preserveStagedPaymentExchangeRate,
  type RampBillPaymentDependencies,
  rampPaymentDate,
  syncRampBillPayment
} from "./ramp-sync-payment";

describe("resumable Ramp payments", () => {
  it("posts a newly staged Draft and requires an observable Posted state", async () => {
    const stage = vi.fn().mockResolvedValue({
      paymentRowId: "pay-1",
      postAction: "post"
    });
    const post = vi.fn().mockResolvedValue({ error: false });
    const readStatus = vi.fn().mockResolvedValue("Posted");

    await expect(
      ensureRampPaymentPosted({ stage, post, readStatus })
    ).resolves.toEqual({ paymentRowId: "pay-1" });
    expect(post).toHaveBeenCalledWith("pay-1");
  });

  it("resumes a mapped Draft after a prior post failure", async () => {
    const stage = vi.fn().mockResolvedValue({
      paymentRowId: "pay-draft",
      postAction: "post"
    });
    const post = vi.fn().mockResolvedValue({ error: false });
    const readStatus = vi.fn().mockResolvedValue("Posted");

    await ensureRampPaymentPosted({ stage, post, readStatus });
    expect(post).toHaveBeenCalledWith("pay-draft");
  });

  it("does not repost an already Posted mapped payment", async () => {
    const post = vi.fn();
    await expect(
      ensureRampPaymentPosted({
        stage: vi.fn().mockResolvedValue({
          paymentRowId: "pay-posted",
          postAction: "none"
        }),
        post,
        readStatus: vi.fn().mockResolvedValue("Posted")
      })
    ).resolves.toEqual({ paymentRowId: "pay-posted" });
    expect(post).not.toHaveBeenCalled();
  });

  it("accepts an ambiguous post response only when the row is observably Posted", async () => {
    const result = await ensureRampPaymentPosted({
      stage: vi.fn().mockResolvedValue({
        paymentRowId: "pay-1",
        postAction: "post"
      }),
      post: vi.fn().mockResolvedValue({
        error: true,
        message: "request timed out"
      }),
      readStatus: vi.fn().mockResolvedValue("Posted")
    });
    expect(result).toEqual({ paymentRowId: "pay-1" });
  });

  it("fails instead of confirming while the payment remains Draft", async () => {
    await expect(
      ensureRampPaymentPosted({
        stage: vi.fn().mockResolvedValue({
          paymentRowId: "pay-1",
          postAction: "post"
        }),
        post: vi.fn().mockResolvedValue({
          error: true,
          message: "request timed out"
        }),
        readStatus: vi.fn().mockResolvedValue("Draft")
      })
    ).rejects.toThrow("request timed out");
  });

  it("refuses to guess the mapping for a legacy untracked payment", () => {
    expect(() =>
      assertNoLegacyUntrackedPayment(false, "legacy-payment")
    ).toThrow("requires operator reconciliation");
    expect(() =>
      assertNoLegacyUntrackedPayment(true, "legacy-payment")
    ).not.toThrow();
  });

  it("keeps the original source FX snapshot when resuming a Draft", () => {
    expect(preserveStagedPaymentExchangeRate(1.2, 1.15)).toBe(1.15);
    expect(preserveStagedPaymentExchangeRate(1.2, null)).toBe(1.2);
  });
});

describe("card-paid Ramp bills", () => {
  // Every case here returns before the database or Ramp is read.
  const deps = (
    overrides: Partial<RampBillPaymentDependencies> = {}
  ): RampBillPaymentDependencies =>
    ({
      companyId: "co",
      baseCurrency: "USD",
      statementBankAccountId: "bank",
      card: { accountId: "card" },
      ...overrides
    }) as RampBillPaymentDependencies;
  const bill = { id: "bill-1" };
  const cardPayment = (transactionIds: string[] | null) => ({
    id: "bp-1",
    payment_method: "CARD",
    details: { transaction_ids: transactionIds }
  });

  it("reports a card account that cannot pay a bill", async () => {
    await expect(
      syncRampBillPayment(
        deps({ card: { error: "Not a Credit Card account" } }),
        bill,
        cardPayment(["tx-1"])
      )
    ).resolves.toEqual({
      fail: { id: "bp-1", message: "Not a Credit Card account" }
    });
  });

  it.each([[null], [[]]])(
    "fails a card payment with no matched transaction (%j)",
    async (transactionIds) => {
      await expect(
        syncRampBillPayment(deps(), bill, cardPayment(transactionIds))
      ).resolves.toEqual({
        fail: {
          id: "bp-1",
          message: "Ramp has matched no card transaction to this bill payment"
        }
      });
    }
  );

  it("needs the statement bank account only for a bank rail", async () => {
    await expect(
      syncRampBillPayment(deps({ statementBankAccountId: null }), bill, {
        id: "bp-2",
        payment_method: "ACH"
      })
    ).resolves.toEqual({
      fail: {
        id: "bp-2",
        message: "Set the Ramp statement bank account to sync bank-paid bills"
      }
    });
  });
});

describe("rampPaymentDate", () => {
  it("keeps Ramp's paid date on or after the invoice's posting", () => {
    expect(rampPaymentDate("2026-11-10", "2026-11-01")).toBe("2026-11-10");
    expect(rampPaymentDate("2026-11-10", "2026-11-10")).toBe("2026-11-10");
    expect(rampPaymentDate("2026-11-10", null)).toBe("2026-11-10");
  });

  it("moves a payment Ramp made before the bill synced to the invoice's posting", () => {
    expect(rampPaymentDate("2026-11-10", "2026-11-18")).toBe("2026-11-18");
  });

  it("has no date without Ramp's", () => {
    expect(rampPaymentDate(null, "2026-11-18")).toBeNull();
  });
});
