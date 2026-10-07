// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { RentalScheduleFact } from "../post-sales-invoice/rental-posting";
import { planRentalCredit, type RentalCreditPeriod } from "./rental-credit";

/** USD. */
const DECIMALS = 2;

// October billed 1,500 in advance; the unit came back on the 5th, so 5 of 31
// days were used and 1,258.06 is credited.
const OCTOBER: RentalCreditPeriod = {
  id: "rbp-oct-adj",
  rentalAgreementLineId: "line-1",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  amount: -1258.06,
  classification: "Rental"
};

const plannedOctober = (amount: number): RentalScheduleFact => ({
  id: "rrs-oct",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  scheduledDate: "2026-10-31",
  amount
});

const plan = (
  periods: RentalCreditPeriod[],
  planned: RentalScheduleFact[],
  memoAmount = 1258.06
) =>
  planRentalCredit({
    memoAmount,
    decimals: DECIMALS,
    periods,
    plannedDeferrals: new Map([["line-1", planned]]),
    rentalAgreementId: "ra-1"
  });

describe("planRentalCredit", () => {
  it("takes an unrecognized credit off deferred revenue and shrinks the period's Planned rows", () => {
    const result = plan([OCTOBER], [plannedOctober(1500)]);
    expect(result.legs).toEqual([
      {
        account: "deferredRevenue",
        accountClass: "Liability",
        description: "Deferred Revenue",
        credit: -1258.06
      }
    ]);
    expect(result.scheduleRows).toEqual([
      {
        rentalAgreementLineId: "line-1",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        scheduledDate: "2026-10-31",
        amount: -1258.06
      }
    ]);
  });

  it("takes a credit off rental income once the period has been recognized", () => {
    // October's run posted before the credit: nothing Planned is left.
    const result = plan([OCTOBER], []);
    expect(result.legs).toEqual([
      {
        account: "rentalIncome",
        accountClass: "Revenue",
        description: "Rental Income",
        credit: -1258.06
      }
    ]);
    expect(result.scheduleRows).toEqual([]);
  });

  it("splits a credit larger than what is still deferred", () => {
    const result = plan([OCTOBER], [plannedOctober(1000)]);
    expect(result.legs.map((leg) => [leg.account, leg.credit])).toEqual([
      ["deferredRevenue", -1000],
      ["rentalIncome", -258.06]
    ]);
    // The legs add up to the AR credit.
    expect(result.legs.reduce((sum, leg) => sum + leg.credit, 0)).toBeCloseTo(
      -1258.06,
      10
    );
  });

  it("apportions the memo across periods cut before billing rounded to cents", () => {
    const legacy = { ...OCTOBER, amount: -1258.06452 };
    const result = plan([legacy], [plannedOctober(1500)]);
    expect(result.scheduleRows.map((row) => row.amount)).toEqual([-1258.06]);
  });

  it("refuses a memo whose amount no longer matches its periods", () => {
    expect(() => plan([OCTOBER], [plannedOctober(1500)], 1000)).toThrow(
      "the early returns it credits come to 1258.06"
    );
    expect(() => plan([], [])).toThrow("bills no early-return periods");
  });

  it("refuses a credit on a unit treated as a sale", () => {
    expect(() =>
      plan([{ ...OCTOBER, classification: "Sale" }], [plannedOctober(1500)])
    ).toThrow(
      "Early-return credits do not apply to a rental treated as a sale"
    );
  });
});
