// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { planningWeekGeometry } from "../app/modules/production/ui/Planning/planning-week-geometry";

describe("planningWeekGeometry", () => {
  it("puts the zero line at the bottom when nothing is short", () => {
    const { zero, heights } = planningWeekGeometry([100, 50, 25]);
    expect(zero).toBe(100);
    expect(heights).toEqual([100, 50, 25]);
  });

  it("puts the zero line at the top when every week is short", () => {
    const { zero, heights } = planningWeekGeometry([-10, -40]);
    expect(zero).toBe(0);
    expect(heights).toEqual([25, 100]);
  });

  it("splits the strip in proportion to the stock above and the shortfall below", () => {
    // 300 above, 100 below: the line sits three quarters of the way down
    const { zero, heights } = planningWeekGeometry([300, 100, -100]);
    expect(zero).toBe(75);
    expect(heights).toEqual([75, 25, 25]);
  });

  it("gives a zero or missing week no bar", () => {
    const { heights } = planningWeekGeometry([10, 0, undefined, -10]);
    expect(heights).toEqual([50, 0, 0, 50]);
  });

  it("draws a flat line through the middle when there is nothing to scale to", () => {
    expect(planningWeekGeometry([0, undefined, 0])).toEqual({
      zero: 50,
      heights: [0, 0, 0]
    });
    expect(planningWeekGeometry([])).toEqual({ zero: 50, heights: [] });
  });
});
