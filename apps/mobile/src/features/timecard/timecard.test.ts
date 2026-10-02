// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  canViewNextWeek,
  clockAction,
  dayGroups,
  durationParts,
  entryCalendarDay,
  entryDurationMs,
  formatClockMoment,
  formatClockTime,
  formatDayLabel,
  formatWeekRange,
  nextWeek,
  startedBeforeToday,
  weekTotalMs
} from "./logic";

/**
 * The time card's pure core, pinned with real values.
 *
 * Every case here is a real bug rather than a hypothetical one: a day that
 * renders as the day before, a week assumed to be 168 hours, a total that
 * counts the open entry twice or not at all, a Clock out button offered to
 * somebody a supervisor already clocked out. None of them throw — they report
 * the wrong number of hours, and this number is what an operator is paid for.
 *
 * `America/New_York` is used throughout because it is behind UTC (so a
 * UTC-parsed day shifts) and because its daylight-saving transitions are
 * ordinary Sundays, which is exactly when a weekly total goes wrong.
 */

const NY = "America/New_York";

describe("entryDurationMs", () => {
  it("measures a closed entry from its own two instants", () => {
    expect(
      entryDurationMs(
        {
          clockIn: "2026-10-05T12:03:00.000Z",
          clockOut: "2026-10-05T20:04:00.000Z"
        },
        0
      )
    ).toBe(8 * 3_600_000 + 60_000);
  });

  it("runs an open entry to now, and ignores now for a closed one", () => {
    const open = { clockIn: "2026-10-05T12:00:00.000Z", clockOut: null };
    const now = Date.UTC(2026, 9, 5, 14, 30);
    expect(entryDurationMs(open, now)).toBe(2.5 * 3_600_000);

    const closed = {
      clockIn: "2026-10-05T12:00:00.000Z",
      clockOut: "2026-10-05T13:00:00.000Z"
    };
    expect(entryDurationMs(closed, now)).toBe(3_600_000);
  });

  it("reads PostgREST's microsecond precision and its offset form", () => {
    // The column is `timestamptz`, so this is the shape that actually arrives.
    expect(
      entryDurationMs(
        {
          clockIn: "2026-10-05T12:00:00.123456+00:00",
          clockOut: "2026-10-05T13:00:00.123456+00:00"
        },
        0
      )
    ).toBe(3_600_000);
  });

  it("floors a clock-skewed or unreadable entry at zero", () => {
    // A device clock behind the server's: "-0h -14m" reads as a payroll error.
    expect(
      entryDurationMs(
        { clockIn: "2026-10-05T12:00:00.000Z" },
        Date.UTC(2026, 9, 5, 11)
      )
    ).toBe(0);
    expect(entryDurationMs({ clockIn: "not a date" }, Date.now())).toBe(0);
  });

  it("is an hour LONGER across a fall-back transition than its wall clock", () => {
    // 2026-11-01: America/New_York repeats 01:00–02:00. An operator who
    // clocked in at 00:30 and out at 02:30 local worked THREE hours, not two.
    // Subtracting the instants gets that right; wall-clock arithmetic does not.
    expect(
      entryDurationMs(
        {
          clockIn: "2026-11-01T04:30:00.000Z", // 00:30 EDT
          clockOut: "2026-11-01T07:30:00.000Z" // 02:30 EST
        },
        0
      )
    ).toBe(3 * 3_600_000);
  });
});

describe("weekTotalMs", () => {
  it("sums the entries, open one included, never 24-hour days", () => {
    const now = Date.UTC(2026, 9, 5, 14, 0);
    const total = weekTotalMs(
      [
        { clockIn: "2026-10-05T12:00:00.000Z", clockOut: null },
        {
          clockIn: "2026-10-02T12:00:00.000Z",
          clockOut: "2026-10-02T20:00:00.000Z"
        },
        {
          clockIn: "2026-10-01T13:00:00.000Z",
          clockOut: "2026-10-01T17:30:00.000Z"
        }
      ],
      now
    );
    expect(total).toBe(2 * 3_600_000 + 8 * 3_600_000 + 4.5 * 3_600_000);
  });

  it("survives a spring-forward week, which is 167 hours and not 168", () => {
    // 2026-03-08 is the transition. Five ordinary 8-hour shifts across it
    // still total 40 hours, because each one is measured on its own instants.
    const shifts = [
      ["2026-03-05T13:00:00.000Z", "2026-03-05T21:00:00.000Z"],
      ["2026-03-06T13:00:00.000Z", "2026-03-06T21:00:00.000Z"],
      ["2026-03-07T13:00:00.000Z", "2026-03-07T21:00:00.000Z"],
      ["2026-03-09T12:00:00.000Z", "2026-03-09T20:00:00.000Z"],
      ["2026-03-10T12:00:00.000Z", "2026-03-10T20:00:00.000Z"]
    ].map(([clockIn, clockOut]) => ({ clockIn: clockIn ?? "", clockOut }));
    expect(weekTotalMs(shifts, 0)).toBe(40 * 3_600_000);
  });

  it("is zero for a week with no entries", () => {
    expect(weekTotalMs([], Date.now())).toBe(0);
  });
});

describe("durationParts", () => {
  it("splits into whole hours and minutes, uncapped and truncating", () => {
    expect(durationParts(8 * 3_600_000 + 60_000)).toEqual({
      hours: 8,
      minutes: 1
    });
    // 59.9 seconds is not a worked minute yet.
    expect(durationParts(59_900)).toEqual({ hours: 0, minutes: 0 });
    // A 40-hour week is 40 hours, not "1 day 16 hours".
    expect(durationParts(40 * 3_600_000)).toEqual({ hours: 40, minutes: 0 });
    expect(durationParts(-5_000)).toEqual({ hours: 0, minutes: 0 });
  });
});

describe("clockAction", () => {
  it("asks for exactly one action per state", () => {
    expect(clockAction(null)).toBe("clock_in");
    expect(clockAction(undefined)).toBe("clock_in");
    expect(
      clockAction({ clockIn: "2026-10-05T12:00:00.000Z", clockOut: null })
    ).toBe("clock_out");
  });

  it("treats a settled entry as clocked out", () => {
    // Somebody else closed it. Offering Clock out would tell the operator
    // their own tap failed when it was the state that moved.
    expect(
      clockAction({
        clockIn: "2026-10-05T12:00:00.000Z",
        clockOut: "2026-10-05T20:00:00.000Z"
      })
    ).toBe("clock_in");
  });
});

describe("week navigation", () => {
  it("never steps into a week that has not begun", () => {
    expect(canViewNextWeek(0)).toBe(false);
    expect(canViewNextWeek(-1)).toBe(true);
    expect(nextWeek(0)).toBe(0);
    expect(nextWeek(-3)).toBe(-2);
  });
});

describe("entryCalendarDay", () => {
  it("names the day the operator was standing in, not UTC's", () => {
    // 2026-10-05T23:30 in New York is 2026-10-06T03:30 UTC. A late shift
    // belongs to Monday; a UTC read would file it on Tuesday.
    expect(entryCalendarDay("2026-10-06T03:30:00.000Z", NY)).toBe("2026-10-05");
    expect(entryCalendarDay("2026-10-06T03:30:00.000Z", "UTC")).toBe(
      "2026-10-06"
    );
  });

  it("returns null rather than throwing on an unreadable instant", () => {
    expect(entryCalendarDay("", NY)).toBeNull();
    expect(entryCalendarDay("yesterday", NY)).toBeNull();
  });
});

describe("dayGroups", () => {
  it("buckets by local day, keeps the server's order, totals each day", () => {
    const now = Date.UTC(2026, 9, 5, 18, 0);
    const groups = dayGroups(
      [
        // Two entries on Monday the 5th, newest first, the second still open.
        { id: "c", clockIn: "2026-10-05T17:00:00.000Z", clockOut: null },
        {
          id: "b",
          clockIn: "2026-10-05T12:00:00.000Z",
          clockOut: "2026-10-05T16:00:00.000Z"
        },
        // Friday the 2nd.
        {
          id: "a",
          clockIn: "2026-10-02T12:00:00.000Z",
          clockOut: "2026-10-02T20:00:00.000Z"
        }
      ],
      NY,
      now
    );

    expect(groups.map((group) => group.day)).toEqual([
      "2026-10-05",
      "2026-10-02"
    ]);
    expect(groups[0]?.entries.map((entry) => entry.id)).toEqual(["c", "b"]);
    expect(groups[0]?.totalMs).toBe(1 * 3_600_000 + 4 * 3_600_000);
    expect(groups[1]?.totalMs).toBe(8 * 3_600_000);
  });

  it("keeps an unreadable entry visible under an empty day", () => {
    const groups = dayGroups([{ clockIn: "???" }], NY, Date.now());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.day).toBe("");
    expect(groups[0]?.entries).toHaveLength(1);
    expect(groups[0]?.totalMs).toBe(0);
  });
});

describe("formatDayLabel", () => {
  it("renders the stored day itself, with no timezone shift", () => {
    // The bug this exists to prevent: `new Date("2026-10-05")` is midnight UTC,
    // which is Sunday the 4th in every American zone — so Monday's hours would
    // appear under Sunday.
    expect(formatDayLabel("2026-10-05", "en-US")).toBe("Mon, Oct 5");
    expect(formatDayLabel("2026-01-01", "en-US")).toBe("Thu, Jan 1");
  });
});

describe("formatWeekRange", () => {
  it("spans two months from the server's own Monday and Sunday", () => {
    expect(formatWeekRange("2026-09-28", "2026-10-04", "en-US")).toBe(
      "Sep 28 – Oct 4"
    );
  });
});

describe("startedBeforeToday", () => {
  it("spots the forgotten clock-out, on the local calendar", () => {
    // 2026-10-06T03:30Z is still Monday the 5th in New York, so against a
    // "today" of the 6th it IS yesterday's entry — and against the 5th it is
    // not. A UTC read would get the first of those wrong.
    expect(
      startedBeforeToday("2026-10-06T03:30:00.000Z", NY, "2026-10-06")
    ).toBe(true);
    expect(
      startedBeforeToday("2026-10-06T03:30:00.000Z", NY, "2026-10-05")
    ).toBe(false);
  });

  it("does not call an unreadable instant old", () => {
    // A warning on every row teaches the operator to ignore the one that counts.
    expect(startedBeforeToday("", NY, "2026-10-06")).toBe(false);
  });
});

describe("formatClockMoment", () => {
  it("is a time today and a day plus a time otherwise", () => {
    expect(
      formatClockMoment("2026-10-05T12:03:00.000Z", NY, "en-US", "2026-10-05")
    ).toBe("8:03 AM");
    expect(
      formatClockMoment("2026-10-05T12:03:00.000Z", NY, "en-US", "2026-10-07")
    ).toBe("Mon, Oct 5, 8:03 AM");
  });
});

describe("formatClockTime", () => {
  it("resolves the offset at the instant, so a DST shift stays honest", () => {
    // 12:03 UTC is 8:03 in New York while daylight saving is on …
    expect(formatClockTime("2026-10-05T12:03:00.000Z", NY, "en-US")).toBe(
      "8:03 AM"
    );
    // … and 7:03 once it is off. Same UTC time, different wall clock.
    expect(formatClockTime("2026-11-05T12:03:00.000Z", NY, "en-US")).toBe(
      "7:03 AM"
    );
  });

  it("hands back the raw value rather than throwing on a bad instant", () => {
    expect(formatClockTime("nope", NY, "en-US")).toBe("nope");
  });
});
