// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { estimateArrival, planShipByDates } from "./sales.utils";

// 2026-11-20 is a Friday; 2026-11-27 is the Friday after.
const part = (id: string, promisedDate: string | null, sentComplete = false) =>
  ({ id, salesOrderLineType: "Part", sentComplete, promisedDate }) as const;

describe("estimateArrival", () => {
  it("adds the transit days in business days", () => {
    expect(estimateArrival("2026-11-20", 5)).toBe("2026-11-27");
  });

  it("is null when the ship-by date or the transit days are unknown", () => {
    expect(estimateArrival(null, 5)).toBeNull();
    expect(estimateArrival("2026-11-20", null)).toBeNull();
  });

  it("keeps the ship-by date for 0 transit days", () => {
    expect(estimateArrival("2026-11-20", 0)).toBe("2026-11-20");
  });
});

describe("planShipByDates", () => {
  it("proposes arrive-by minus the transit days for each line", () => {
    const [line] = planShipByDates({
      arriveBy: "2026-11-27",
      transitDays: 5,
      lines: [part("a", null)]
    });
    expect(line).toMatchObject({ proposedShipBy: "2026-11-20", changes: true });
  });

  it("moves 3 open lines, keeps a fully shipped one", () => {
    const plan = planShipByDates({
      arriveBy: "2026-11-27",
      transitDays: 5,
      lines: [
        part("a", "2026-11-16"),
        part("b", "2026-11-17"),
        part("c", "2026-11-18"),
        part("shipped", "2026-11-10", true)
      ]
    });
    expect(plan.filter((line) => line.changes).map((line) => line.id)).toEqual([
      "a",
      "b",
      "c"
    ]);
  });

  it("does not move a line already on the proposed date", () => {
    const [line] = planShipByDates({
      arriveBy: "2026-11-27",
      transitDays: 5,
      lines: [part("a", "2026-11-20")]
    });
    expect(line?.changes).toBe(false);
  });

  it("flags a line that arrives after the arrive-by date", () => {
    const [late, onTime] = planShipByDates({
      arriveBy: "2026-11-27",
      transitDays: 5,
      lines: [part("late", "2026-11-23"), part("onTime", "2026-11-20")]
    });
    expect(late).toMatchObject({
      estimatedArrival: "2026-11-30",
      lateToArrive: true
    });
    expect(onTime?.lateToArrive).toBe(false);
  });

  it("skips a line that ships no item", () => {
    const [line] = planShipByDates({
      arriveBy: "2026-11-27",
      transitDays: 5,
      lines: [
        {
          id: "svc",
          salesOrderLineType: "Service",
          sentComplete: false,
          promisedDate: null
        }
      ]
    });
    expect(line).toMatchObject({ changes: false, lateToArrive: false });
  });

  it("changes nothing when the transit days or the arrive-by date are unknown", () => {
    for (const plan of [
      planShipByDates({
        arriveBy: "2026-11-27",
        transitDays: null,
        lines: [part("a", "2026-11-16")]
      }),
      planShipByDates({
        arriveBy: null,
        transitDays: 5,
        lines: [part("a", "2026-11-16")]
      })
    ]) {
      expect(plan[0]).toMatchObject({ changes: false, lateToArrive: false });
    }
  });

  it("skips a holiday while it counts back", () => {
    const [line] = planShipByDates({
      arriveBy: "2026-11-27",
      transitDays: 5,
      holidays: new Set(["2026-11-26"]),
      lines: [part("a", null)]
    });
    expect(line?.proposedShipBy).toBe("2026-11-19");
  });
});
