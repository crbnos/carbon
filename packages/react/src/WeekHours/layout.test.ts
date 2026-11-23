// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { fillToPointer, snapHours, stackDay } from "./layout";

describe("snapHours", () => {
  it("snaps to the half hour", () => {
    expect(snapHours(3.2)).toBe(3);
    expect(snapHours(3.3)).toBe(3.5);
    expect(snapHours(7.74)).toBe(7.5);
    expect(snapHours(7.75)).toBe(8);
  });

  it("stays between 0 and the maximum", () => {
    expect(snapHours(-2)).toBe(0);
    expect(snapHours(30)).toBe(24);
    expect(snapHours(10, 6)).toBe(6);
    expect(snapHours(Number.NaN)).toBe(0);
  });
});

describe("stackDay", () => {
  it("stacks the rows with hours in their order", () => {
    expect(
      stackDay([
        { key: "a", hours: 3 },
        { key: "b", hours: 0 },
        { key: "c", hours: 4.5 }
      ])
    ).toEqual({
      bars: [
        { key: "a", start: 0, hours: 3 },
        { key: "c", start: 3, hours: 4.5 }
      ],
      total: 7.5
    });
  });
});

describe("stackDay order", () => {
  it("stacks by when the time was entered, new time last", () => {
    const { bars } = stackDay([
      { key: "a", hours: 3, enteredAt: "2026-10-08T10:00:00Z" },
      { key: "b", hours: 2, enteredAt: null },
      { key: "c", hours: 5, enteredAt: "2026-10-08T09:00:00Z" }
    ]);
    expect(bars.map((bar) => bar.key)).toEqual(["c", "a", "b"]);
    expect(bars.map((bar) => bar.start)).toEqual([0, 5, 8]);
  });
});

describe("fillToPointer", () => {
  it("makes the day reach the click", () => {
    expect(fillToPointer({ pointerHours: 8.2, others: 3, current: 0 })).toBe(5);
  });

  it("gives a new bar at least half an hour", () => {
    expect(fillToPointer({ pointerHours: 3.1, others: 3, current: 0 })).toBe(
      0.5
    );
  });

  it("never shrinks the selected row", () => {
    expect(fillToPointer({ pointerHours: 4, others: 0, current: 6 })).toBe(6);
  });

  it("keeps the day within 24 hours", () => {
    expect(fillToPointer({ pointerHours: 30, others: 20, current: 0 })).toBe(4);
  });
});
