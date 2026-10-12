// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The rows Modify cuts are pinned with the shared cutter
// (`../lib/lease-payment-rows.test.ts`).

import { describe, expect, it } from "vitest";
import { leaseMonthStarting, straddledPeriod } from "./lifecycle";

describe("leaseMonthStarting", () => {
  it("accepts a lease month that starts on a clamped day", () => {
    expect(leaseMonthStarting("2026-01-31", "2026-02-28")).toBe(1);
    expect(leaseMonthStarting("2026-01-31", "2026-03-31")).toBe(2);
    expect(leaseMonthStarting("2026-01-31", "2026-03-30")).toBeNull();
  });
});

describe("straddledPeriod", () => {
  const quarter = {
    paymentType: "Rent",
    periodStart: "2027-01-01",
    periodEnd: "2027-03-31"
  };

  it("finds the payment period a date falls inside", () => {
    expect(straddledPeriod([quarter], "2027-02-01")).toEqual(quarter);
  });

  it("accepts the first day of a period and the day after its end", () => {
    expect(straddledPeriod([quarter], "2027-01-01")).toBeNull();
    expect(straddledPeriod([quarter], "2027-04-01")).toBeNull();
  });

  it("ignores a purchase option or penalty row", () => {
    expect(
      straddledPeriod(
        [{ ...quarter, paymentType: "Purchase Option" }],
        "2027-02-01"
      )
    ).toBeNull();
  });
});
