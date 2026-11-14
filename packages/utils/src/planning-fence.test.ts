// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  isPlannedOrderHeld,
  planningTimeFenceDate,
  resolvePlanningTimeFenceDays
} from "./planning-fence";

describe("resolvePlanningTimeFenceDays", () => {
  it.each([
    [5, 10, 5],
    [0, 10, 0],
    [null, 10, 10],
    [undefined, null, 0],
    [-3, 10, 0]
  ])("item %s, location %s → %s", (item, location, expected) => {
    expect(resolvePlanningTimeFenceDays(item, location)).toBe(expected);
  });
});

describe("isPlannedOrderHeld", () => {
  const today = "2026-11-14";
  it("holds a Firm order with no fence", () => {
    expect(
      isPlannedOrderHeld(
        { status: "Firm", releaseDate: "2027-01-01" },
        0,
        today
      )
    ).toBe(true);
  });
  it("holds a Planned order released on the fence date, not the day after", () => {
    expect(planningTimeFenceDate(today, 10)).toBe("2026-11-24");
    expect(
      isPlannedOrderHeld(
        { status: "Planned", releaseDate: "2026-11-24" },
        10,
        today
      )
    ).toBe(true);
    expect(
      isPlannedOrderHeld(
        { status: "Planned", releaseDate: "2026-11-25" },
        10,
        today
      )
    ).toBe(false);
  });
  it("holds no Planned order without a fence, and never a Converted one", () => {
    expect(
      isPlannedOrderHeld(
        { status: "Planned", releaseDate: "2026-11-01" },
        0,
        today
      )
    ).toBe(false);
    expect(
      isPlannedOrderHeld(
        { status: "Converted", releaseDate: "2026-11-01" },
        10,
        today
      )
    ).toBe(false);
  });
});
