// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { dayIndex } from "../Elements/timeline-geometry";
import { scheduleBar, scheduleLayout, spanHolds } from "./schedule-scale";

const dates = ["2026-08-13", "2026-10-02", "2026-10-03", "2026-11-26"];
const today = "2026-10-12";

describe("scheduleLayout", () => {
  it("covers whole quarters with a month of margin at the month scale", () => {
    const layout = scheduleLayout(dates, today, "month");
    expect(layout.start).toBe("2026-07-01");
    expect(layout.end).toBe("2026-12-31");
    expect(layout.groups).toEqual([
      { start: "2026-07-01", end: "2026-09-30" },
      { start: "2026-10-01", end: "2026-12-31" }
    ]);
    expect(layout.columns.map((c) => c.start)).toEqual([
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
      "2026-11-01",
      "2026-12-01"
    ]);
    expect(layout.days).toBe(184);
  });

  it("starts the week scale on a Monday and ends it on a Sunday", () => {
    const layout = scheduleLayout(dates, today, "week");
    expect(layout.start).toBe("2026-07-27");
    expect(layout.end).toBe("2026-12-06");
    expect(layout.columns[0]).toEqual({
      start: "2026-07-27",
      end: "2026-08-02"
    });
    expect(
      layout.columns.every((c, i, all) => i === 0 || c.start > all[i - 1]!.end)
    ).toBe(true);
    // The first month is clipped to the window.
    expect(layout.groups[0]).toEqual({
      start: "2026-07-27",
      end: "2026-07-31"
    });
  });

  it("covers whole years at the quarter scale, with a quarter of margin", () => {
    const layout = scheduleLayout(dates, today, "quarter");
    expect(layout.start).toBe("2026-01-01");
    // The margin quarter after Q4 2026 is Q1 2027, so all of 2027 shows.
    expect(layout.end).toBe("2027-12-31");
    expect(layout.columns).toHaveLength(8);
  });

  it("includes today when every milestone is in the past", () => {
    const layout = scheduleLayout(["2025-02-10"], "2026-10-12", "month");
    expect(layout.start <= "2025-02-10").toBe(true);
    expect(layout.end >= "2026-10-12").toBe(true);
  });

  it("works with no dated milestone", () => {
    const layout = scheduleLayout([null], today, "month");
    expect(layout.start).toBe("2026-07-01");
    expect(layout.end).toBe("2026-12-31");
  });

  it("adds whole periods until the window is at least minDays long", () => {
    const layout = scheduleLayout(dates, today, "month", 300);
    expect(layout.days).toBeGreaterThanOrEqual(300);
    expect(layout.end).toBe("2027-06-30");
  });

  it("tiles the window with columns that leave no gap", () => {
    for (const scale of ["week", "month", "quarter"] as const) {
      const layout = scheduleLayout(dates, today, scale);
      const covered = layout.columns.reduce(
        (sum, c) => sum + dayIndex(c.end, c.start) + 1,
        0
      );
      expect(covered).toBe(layout.days);
    }
  });
});

describe("scheduleBar", () => {
  it("spans the start to the end, both days included", () => {
    expect(
      scheduleBar(
        { startDate: "2026-10-03", endDate: "2026-10-05" },
        "2026-10-01"
      )
    ).toEqual({ offset: 2, length: 3 });
  });

  it("draws one day for a single date and nothing without dates", () => {
    expect(
      scheduleBar({ startDate: null, endDate: "2026-10-05" }, "2026-10-01")
    ).toEqual({ offset: 4, length: 1 });
    expect(scheduleBar({ startDate: null, endDate: null }, "2026-10-01")).toBe(
      null
    );
  });

  it("draws one day at the start when the end is earlier", () => {
    expect(
      scheduleBar(
        { startDate: "2026-10-05", endDate: "2026-10-02" },
        "2026-10-01"
      )
    ).toEqual({ offset: 4, length: 1 });
  });
});

describe("spanHolds", () => {
  it("includes both ends", () => {
    const span = { start: "2026-10-01", end: "2026-10-31" };
    expect(spanHolds(span, "2026-10-01")).toBe(true);
    expect(spanHolds(span, "2026-10-31")).toBe(true);
    expect(spanHolds(span, "2026-11-01")).toBe(false);
  });
});
