// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  arrowPath,
  barRect,
  dayIndex,
  defaultWindow
} from "~/modules/projects/ui/Elements/timeline-geometry";

describe("timeline geometry", () => {
  it("counts the whole days between two dates", () => {
    expect(dayIndex("2026-10-08", "2026-10-01")).toBe(7);
  });

  it("places a bar from its start to its target, both days included", () => {
    const rect = barRect(
      { startDate: "2026-10-03", targetDate: "2026-10-05" },
      "2026-10-01",
      40,
      0,
      44
    );
    expect(rect).toMatchObject({ x: 80, width: 120 });
  });

  it("gives an element with only a target date a 1-day bar", () => {
    const rect = barRect(
      { startDate: null, targetDate: "2026-10-05" },
      "2026-10-01",
      40,
      2,
      44
    );
    expect(rect).toMatchObject({ x: 160, width: 40 });
  });

  it("starts an arrow at the right edge of the from bar", () => {
    const from = { x: 80, y: 10, width: 120, height: 24 };
    const to = { x: 280, y: 54, width: 40, height: 24 };
    expect(arrowPath(from, to).startsWith("M 200 22")).toBe(true);
  });

  it("pads the window around the dates", () => {
    expect(
      defaultWindow(
        [{ startDate: "2026-10-03", targetDate: "2026-10-20" }],
        "2026-01-01"
      )
    ).toEqual({ start: "2026-09-30", end: "2026-10-27" });
  });
});
