import { describe, expect, it, vi } from "vitest";
import {
  assertNoLegacyUntrackedPayment,
  ensureRampPaymentPosted,
  preserveStagedPaymentExchangeRate
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
