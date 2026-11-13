// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { carbonSettlementRate } from "./settlement-rate";

describe("carbonSettlementRate", () => {
  it("inverts Stripe's rate when Stripe settled into the base currency", () => {
    // A EUR invoice in a USD company: Stripe converts EUR 1,000 into
    // USD 1,087 (rate 1.087 USD per EUR). Carbon books EUR per USD.
    const rate = carbonSettlementRate({
      stripeRate: 1.087,
      settlementCurrency: "USD",
      baseCurrency: "usd"
    });
    expect(rate).toBeCloseTo(1 / 1.087, 12);
    expect(1000 / (rate as number)).toBeCloseTo(1087, 9);
  });

  it("ignores Stripe's rate when the settlement currency is not the base currency", () => {
    // A USD invoice in a USD company settled into a EUR Stripe balance: the
    // cash in base currency is the invoice amount, at the invoice's rate.
    expect(
      carbonSettlementRate({
        stripeRate: 0.92,
        settlementCurrency: "EUR",
        baseCurrency: "USD"
      })
    ).toBeNull();
  });

  it("returns null when Stripe converted nothing", () => {
    expect(
      carbonSettlementRate({
        stripeRate: null,
        settlementCurrency: null,
        baseCurrency: "USD"
      })
    ).toBeNull();
  });

  it("returns null for a zero or negative rate", () => {
    expect(
      carbonSettlementRate({
        stripeRate: 0,
        settlementCurrency: "USD",
        baseCurrency: "USD"
      })
    ).toBeNull();
  });
});
