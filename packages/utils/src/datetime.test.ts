import {
  CalendarDate,
  CalendarDateTime,
  toZoned
} from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { datetime } from "./datetime";

describe("datetime.businessDay", () => {
  it("assigns a late-evening US instant to the previous UTC day", () => {
    // 2026-02-01T04:59Z is still Jan 31 in Chicago (UTC-6)
    expect(
      datetime.businessDay("2026-02-01T04:59:00Z", "America/Chicago").toString()
    ).toBe("2026-01-31");
    expect(datetime.businessDay("2026-02-01T04:59:00Z", "UTC").toString()).toBe(
      "2026-02-01"
    );
  });

  it("assigns an early-morning UTC instant to the next day east of UTC", () => {
    // 23:30Z is already the next day in Tokyo (UTC+9)
    expect(
      datetime.businessDay("2026-08-04T23:30:00Z", "Asia/Tokyo").toString()
    ).toBe("2026-08-05");
  });

  it("handles DST transitions", () => {
    // US spring forward 2026-03-08: 07:30Z = 01:30 CST (UTC-6), same calendar day
    expect(
      datetime.businessDay("2026-03-08T07:30:00Z", "America/Chicago").toString()
    ).toBe("2026-03-08");
    // After the jump the offset is -5; 04:30Z on Mar 9 is still Mar 8 23:30 CDT
    expect(
      datetime.businessDay("2026-03-09T04:30:00Z", "America/Chicago").toString()
    ).toBe("2026-03-08");
  });
});

describe("datetime.today / datetime.now", () => {
  it("differ across the date line at the right moments", () => {
    // Can't pin the wall clock in a unit test, but the invariant holds always:
    // Pacific/Kiritimati (UTC+14) and Pacific/Niue (UTC-11) are 25h apart, so
    // they are never on the same calendar day.
    const east = datetime.today("Pacific/Kiritimati");
    const west = datetime.today("Pacific/Niue");
    expect(east.compare(west)).toBeGreaterThan(0);
  });

  it("now() carries the requested timezone", () => {
    expect(datetime.now("America/Chicago").timeZone).toBe("America/Chicago");
  });
});

describe("datetime.timestamp", () => {
  it("returns a UTC instant string", () => {
    expect(datetime.timestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });
});

// DST is where "derive the day in a tz" and "construct an instant from a wall
// time" diverge. Scheduling a job for a specific local start time in a
// DST-enabled zone is the canonical stress case: the wall time may not exist
// (spring-forward gap), may exist twice (fall-back overlap), or — in zones
// that transition AT midnight — the day boundary itself may be skipped.
describe("DST and exotic-zone stress", () => {
  const wb = (tz: string, y: number, m: number, d: number) =>
    datetime.weekBounds(tz, 0, new CalendarDate(y, m, d));
  const hours = (b: { from: string; to: string }) =>
    (Date.parse(b.to) + 1 - Date.parse(b.from)) / 3600000;

  it("spring-forward week is 167h, fall-back week is 169h (America/Chicago)", () => {
    // 2026-03-08 02:00 → 03:00 CST→CDT; 2026-11-01 02:00 → 01:00 CDT→CST.
    expect(hours(wb("America/Chicago", 2026, 3, 8))).toBe(167);
    expect(hours(wb("America/Chicago", 2026, 11, 1))).toBe(169);
    // A week with no transition stays 168h.
    expect(hours(wb("America/Chicago", 2026, 6, 15))).toBe(168);
  });

  it("half-hour DST shift yields a 167.5h week (Australia/Lord_Howe)", () => {
    // Lord Howe shifts +10:30 → +11:00 on 2026-10-04.
    expect(hours(wb("Australia/Lord_Howe", 2026, 10, 4))).toBe(167.5);
  });

  it("survives a zone that springs forward AT midnight (America/Santiago)", () => {
    // Chile DST starts 2026-09-06: 00:00 does not exist; the day begins 01:00.
    // The day-start conversion resolves to the day's true first instant
    // instead of crashing or sliding into Sep 5.
    const dayStart = new CalendarDate(2026, 9, 6).toDate("America/Santiago");
    expect(dayStart.toISOString()).toBe("2026-09-06T04:00:00.000Z"); // 01:00 -03
    expect(
      datetime
        .businessDay(dayStart.toISOString(), "America/Santiago")
        .toString()
    ).toBe("2026-09-06");
    // 1ms earlier is still the previous day.
    expect(
      datetime
        .businessDay(
          new Date(dayStart.getTime() - 1).toISOString(),
          "America/Santiago"
        )
        .toString()
    ).toBe("2026-09-05");
    // The week containing the skipped midnight is 167h.
    expect(hours(wb("America/Santiago", 2026, 9, 6))).toBe(167);
  });

  it("consecutive weeks tile exactly across a transition — no gap, no double-count", () => {
    for (const [tz, y, m, d] of [
      ["America/Chicago", 2026, 3, 8],
      ["America/Chicago", 2026, 11, 1],
      ["America/Santiago", 2026, 9, 6]
    ] as const) {
      const week = wb(tz, y, m, d);
      const next = datetime.weekBounds(tz, 1, new CalendarDate(y, m, d));
      expect(Date.parse(week.to) + 1).toBe(Date.parse(next.from));
    }
  });

  it("a fixed local start time in the spring-forward gap resolves forward, never crashes", () => {
    // "Start the job at 02:30 local" on the day 02:30 doesn't exist:
    // default disambiguation ('compatible') shifts into the post-gap hour.
    const z = toZoned(
      new CalendarDateTime(2026, 3, 8, 2, 30),
      "America/Chicago"
    );
    expect(z.toAbsoluteString()).toBe("2026-03-08T08:30:00.000Z"); // 03:30 CDT
  });

  it("a fixed local start time in the fall-back overlap resolves to the first occurrence", () => {
    // 01:30 happens twice on 2026-11-01; 'compatible' picks the earlier
    // (CDT) one — the job fires once, not twice.
    const z = toZoned(
      new CalendarDateTime(2026, 11, 1, 1, 30),
      "America/Chicago"
    );
    expect(z.toAbsoluteString()).toBe("2026-11-01T06:30:00.000Z"); // 01:30 CDT
  });

  it("a fixed local wall time maps to different UTC instants across the transition", () => {
    // WHY Carbon's Inngest crons stay on UTC schedules: "02:30 local" is
    // 08:30Z before the transition and 07:30Z after — a fixed UTC cron
    // cannot track a local wall time across DST.
    const before = toZoned(
      new CalendarDateTime(2026, 3, 7, 2, 30),
      "America/Chicago"
    );
    const after = toZoned(
      new CalendarDateTime(2026, 3, 9, 2, 30),
      "America/Chicago"
    );
    expect(before.toAbsoluteString()).toBe("2026-03-07T08:30:00.000Z");
    expect(after.toAbsoluteString()).toBe("2026-03-09T07:30:00.000Z");
  });

  it("handles 45-minute offsets (Asia/Kathmandu, +05:45)", () => {
    expect(
      datetime.businessDay("2026-08-05T18:14:00Z", "Asia/Kathmandu").toString()
    ).toBe("2026-08-05");
    expect(
      datetime.businessDay("2026-08-05T18:16:00Z", "Asia/Kathmandu").toString()
    ).toBe("2026-08-06");
  });
});

describe("datetime.weekNumber", () => {
  it("matches the reference UTC-arithmetic implementation for every day 2019-2031", () => {
    // Oracle: the previous native-Date implementation (covers week-53 years,
    // leap years, and both year-boundary spill directions).
    const oracle = (y: number, m: number, day: number): number => {
      const d = new Date(Date.UTC(y, m - 1, day));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil(
        ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
      );
    };
    for (let y = 2019; y <= 2031; y++) {
      for (let m = 1; m <= 12; m++) {
        const first = new CalendarDate(y, m, 1);
        const days = first.calendar.getDaysInMonth(first);
        for (let d = 1; d <= days; d++) {
          expect(datetime.weekNumber(new CalendarDate(y, m, d))).toBe(
            oracle(y, m, d)
          );
        }
      }
    }
  });

  it("matches known ISO 8601 week numbers", () => {
    expect(
      datetime.weekNumber(datetime.businessDay("2026-01-01T12:00:00Z", "UTC"))
    ).toBe(1);
    // 2027-01-01 is a Friday → belongs to ISO week 53 of 2026
    expect(
      datetime.weekNumber(datetime.businessDay("2027-01-01T12:00:00Z", "UTC"))
    ).toBe(53);
    // 2024-12-30 (Monday) belongs to week 1 of 2025
    expect(
      datetime.weekNumber(datetime.businessDay("2024-12-30T12:00:00Z", "UTC"))
    ).toBe(1);
    expect(
      datetime.weekNumber(datetime.businessDay("2026-08-05T12:00:00Z", "UTC"))
    ).toBe(32);
  });
});
