// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { calculateDueDate } from "./calculate-due-date";

describe("calculateDueDate", () => {
  it("Net counts days from the issue date, across months and years", () => {
    expect(
      calculateDueDate("2026-01-15", {
        daysDue: 30,
        calculationMethod: "Net"
      })
    ).toBe("2026-02-14");
    expect(
      calculateDueDate("2026-12-20", {
        daysDue: 15,
        calculationMethod: "Net"
      })
    ).toBe("2027-01-04");
  });

  it("falls back to Net 30 when there is no payment term", () => {
    expect(calculateDueDate("2026-03-01", null)).toBe("2026-03-31");
  });

  it("End of Month counts from the last day of the issue month", () => {
    expect(
      calculateDueDate("2026-02-10", {
        daysDue: 10,
        calculationMethod: "End of Month"
      })
    ).toBe("2026-03-10");
  });

  it("Day of Month is the next occurrence of that day, clamped to the month", () => {
    const term = (daysDue: number) => ({
      daysDue,
      calculationMethod: "Day of Month" as const
    });
    expect(calculateDueDate("2026-01-10", term(15))).toBe("2026-01-15");
    expect(calculateDueDate("2026-01-20", term(15))).toBe("2026-02-15");
    // 31 in a 28-day February clamps rather than spilling into March.
    expect(calculateDueDate("2026-02-01", term(31))).toBe("2026-02-28");
    expect(calculateDueDate("2026-01-31", term(31))).toBe("2026-01-31");
  });

  it("returns null for an unparseable issue date", () => {
    expect(calculateDueDate("not-a-date", null)).toBeNull();
  });
});
