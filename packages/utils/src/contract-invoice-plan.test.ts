// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  CONTRACT_HOLD_ADJUSTMENT,
  contractInvoiceHold,
  recurringHoldRebill
} from "./contract-invoice-plan";

const row = (
  amount: number,
  overrides: Partial<{
    isAdjustment: boolean;
    voidedInvoiceReadableId: string | null;
  }> = {}
) => ({
  amount,
  isAdjustment: false,
  voidedInvoiceReadableId: null,
  ...overrides
});

const negativeAdjustment = row(-206.45, { isAdjustment: true });

describe("contractInvoiceHold", () => {
  it("Draft Only never holds", () => {
    expect(contractInvoiceHold("Draft Only", [negativeAdjustment])).toBeNull();
  });

  it("a re-bill of a voided invoice wins over a negative adjustment", () => {
    expect(
      contractInvoiceHold("Post", [
        row(320, { voidedInvoiceReadableId: "INV-7" }),
        negativeAdjustment
      ])
    ).toEqual("Re-billing INV-7, which was voided");
  });

  it("a negative adjustment holds the invoice", () => {
    expect(contractInvoiceHold("Post and Email", [negativeAdjustment])).toEqual(
      CONTRACT_HOLD_ADJUSTMENT
    );
  });

  it("positive rows are not held", () => {
    expect(
      contractInvoiceHold("Post and Send via Stripe", [row(320), row(100)])
    ).toBeNull();
  });

  it("re-exports the shared re-bill wording", () => {
    expect(recurringHoldRebill(["INV-7", "INV-8"])).toEqual(
      "Re-billing INV-7, INV-8, which were voided"
    );
  });
});
