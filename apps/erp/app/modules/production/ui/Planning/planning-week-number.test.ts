// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { planningWeekNumber } from "./planning-week-number";

// Periods start on a Sunday (`getOrCreatePeriods`), the day before the ISO
// week they mostly cover. Read on the Sunday itself, every heading would be a
// week behind.
describe("planningWeekNumber", () => {
  it("counts from the present week by default", () => {
    expect(planningWeekNumber("2026-10-25", 0, false)).toBe(1);
    expect(planningWeekNumber("2026-11-01", 1, false)).toBe(2);
  });

  it("heads a Sunday-start period with the ISO week of its Monday", () => {
    // Mon 2026-10-26 is in ISO week 44
    expect(planningWeekNumber("2026-10-25", 0, true)).toBe(44);
    expect(planningWeekNumber("2026-11-01", 1, true)).toBe(45);
  });

  it("crosses the year boundary", () => {
    // 2026 starts on a Thursday, so it has 53 ISO weeks
    expect(planningWeekNumber("2026-12-27", 9, true)).toBe(53);
    expect(planningWeekNumber("2027-01-03", 10, true)).toBe(1);
    // Mon 2025-12-29 is already week 1 of 2026
    expect(planningWeekNumber("2025-12-28", 0, true)).toBe(1);
  });

  it("gives the same week for a Monday-start period", () => {
    expect(planningWeekNumber("2026-10-26", 0, true)).toBe(44);
  });
});
