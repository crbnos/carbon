// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { buildBurnSeries } from "~/modules/projects/projects.models";

describe("buildBurnSeries", () => {
  it("draws the ideal line: 100 planned hours over 10 days is 50 on day 5", () => {
    const series = buildBurnSeries({
      startDate: "2026-10-01",
      endDate: "2026-10-11",
      plannedHours: 100,
      entries: []
    });

    expect(series).toHaveLength(11);
    expect(series[5]).toMatchObject({ date: "2026-10-06", day: 5, ideal: 50 });
    expect(series[10]!.ideal).toBe(100);
  });

  it("adds up the posted hours day by day", () => {
    const series = buildBurnSeries({
      startDate: "2026-10-01",
      endDate: "2026-10-11",
      plannedHours: 100,
      entries: [
        { entryDate: "2026-10-02", hours: 4 },
        { entryDate: "2026-10-04", hours: 6 }
      ]
    });

    expect(series[2]!.actual).toBe(4);
    expect(series[3]!.actual).toBe(10);
  });
});
