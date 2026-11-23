// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  CalendarDate,
  CalendarDateTime,
  getDayOfWeek,
  parseAbsolute,
  parseDate,
  toZoned
} from "@internationalized/date";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  asWeekNumbering,
  interpolateSequenceDate,
  interpolateSequenceFormat,
  type WeekNumbering,
  weekNumberings,
  weekOfYear,
  yearFollowsWeek
} from "./sequence-tokens.ts";

const at = (date: string, hour = 13, second = 9) => {
  const { year, month, day } = parseDate(date);
  return toZoned(
    new CalendarDateTime(year, month, day, hour, 5, second),
    "UTC"
  );
};

const format = (
  value: string,
  date: string,
  weekNumbering: WeekNumbering = "iso"
) => interpolateSequenceDate(value, { at: at(date), weekNumbering });

// With a month or a day, the year is the calendar year; without, the week's.
const DATE_FORMAT = "%{yyyy}|%{yy}|%{mm}|%{ww}|%{dd}|%{hh}|%{ss}";
const WEEK_FORMAT = "%{yyyy}|%{yy}|%{ww}|%{hh}|%{ss}";

describe("interpolateSequenceDate", () => {
  // Every day around a new year where the calendar year and the ISO week's
  // year disagree, the US week 54, and a day where every system agrees.
  it.each([
    ["2024-12-30", "Mon", "2501", "2453"],
    ["2024-12-31", "Tue", "2501", "2453"],
    ["2025-12-29", "Mon", "2601", "2553"],
    ["2026-12-27", "Sun", "2652", "2653"],
    ["2026-12-31", "Thu", "2653", "2653"],
    ["2027-01-01", "Fri", "2653", "2701"],
    ["2027-01-02", "Sat", "2653", "2701"],
    ["2027-01-03", "Sun", "2653", "2702"],
    ["2027-01-04", "Mon", "2701", "2702"],
    ["2028-01-01", "Sat", "2752", "2801"],
    ["2028-12-31", "Sun", "2852", "2854"],
    ["2021-01-03", "Sun", "2053", "2102"],
    ["2026-11-18", "Wed", "2647", "2647"]
  ])("%s (%s): %{yy}%{ww} is %s (ISO 8601), %s (US)", (date, _day, iso, us) => {
    expect(format("%{yy}%{ww}", date, "iso")).toBe(iso);
    expect(format("%{yy}%{ww}", date, "us")).toBe(us);
  });

  it("keeps the calendar year beside a month or a day", () => {
    expect(format("%{yyyy}%{mm}%{dd}", "2027-01-01")).toBe("20270101");
    expect(format("%{yyyy}-%{mm}-W%{ww}", "2027-01-01")).toBe("2027-01-W53");
    expect(format("%{yy}%{dd}-%{ww}", "2027-01-01")).toBe("2701-53");
    expect(format("%{yyyy}-W%{ww}", "2027-01-01")).toBe("2026-W53");
  });

  it("fills every token, padded to two digits", () => {
    expect(
      interpolateSequenceDate(DATE_FORMAT, { at: at("2027-01-01", 7, 3) })
    ).toBe("2027|27|01|53|01|07|03");
    expect(
      interpolateSequenceDate(WEEK_FORMAT, { at: at("2027-01-01", 7, 3) })
    ).toBe("2026|26|53|07|03");
    expect(
      interpolateSequenceDate(WEEK_FORMAT, {
        at: at("2027-01-01", 7, 3),
        weekNumbering: "us"
      })
    ).toBe("2027|27|01|07|03");
  });

  it("uses the wall clock of the zone it is given", () => {
    // 12:00 UTC on 31 December 2026 is already 1 January 2027 in Auckland.
    const auckland = parseAbsolute("2026-12-31T12:00:00Z", "Pacific/Auckland");
    expect(
      interpolateSequenceDate("%{yyyy}-%{mm}-%{dd} %{hh}", { at: auckland })
    ).toBe("2027-01-01 01");
    expect(
      interpolateSequenceDate("%{yy}%{ww}", {
        at: auckland,
        weekNumbering: "us"
      })
    ).toBe("2701");
  });

  it("leaves text and unknown tokens as written", () => {
    expect(format("SO-", "2027-01-01")).toBe("SO-");
    expect(format("%{location}-%{yy}", "2027-01-01")).toBe("%{location}-27");
    expect(interpolateSequenceDate(null)).toBe("");
    expect(interpolateSequenceDate("")).toBe("");
  });
});

describe("interpolateSequenceFormat", () => {
  it("takes the year from the whole format", () => {
    const options = { at: at("2027-01-01") };
    // The week in the suffix makes the prefix's year the week's.
    expect(interpolateSequenceFormat("SN%{yy}-", "-W%{ww}", options)).toEqual({
      prefix: "SN26-",
      suffix: "-W53"
    });
    // A day in the prefix keeps the suffix's year the calendar year.
    expect(
      interpolateSequenceFormat("%{dd}-", "-%{yyyy}W%{ww}", options)
    ).toEqual({ prefix: "01-", suffix: "-2027W53" });
    expect(interpolateSequenceFormat(null, undefined, options)).toEqual({
      prefix: "",
      suffix: ""
    });
  });

  it("reads the clock once for both segments", () => {
    // The second read crosses midnight into Monday 4 January 2027, week 1 of
    // 2027. Read twice, the pair would be 26 with week 01.
    const clock = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(Date.parse("2027-01-03T23:59:59.999Z"))
      .mockReturnValueOnce(Date.parse("2027-01-04T00:00:00.001Z"));
    try {
      expect(
        interpolateSequenceFormat("%{yy}-", "-%{ww}", { timezone: "UTC" })
      ).toEqual({ prefix: "26-", suffix: "-53" });
    } finally {
      clock.mockRestore();
    }
  });
});

describe("weekOfYear", () => {
  const mondayOf = (date: CalendarDate) =>
    date.subtract({ days: getDayOfWeek(date, "en-GB") });

  // Independent reference: week 1 is the week of 4 January, and a week runs
  // Monday to Sunday.
  it("ISO 8601: matches the 4 January rule for every day from 2000 to 2100", () => {
    const mismatches: string[] = [];
    let date = new CalendarDate(2000, 1, 1);
    const end = new CalendarDate(2100, 12, 31);
    while (date.compare(end) <= 0) {
      const next = mondayOf(new CalendarDate(date.year + 1, 1, 4));
      const own = mondayOf(new CalendarDate(date.year, 1, 4));
      const year =
        date.compare(next) >= 0
          ? date.year + 1
          : date.compare(own) >= 0
            ? date.year
            : date.year - 1;
      const week =
        mondayOf(date).compare(mondayOf(new CalendarDate(year, 1, 4))) / 7 + 1;
      const actual = weekOfYear(date, "iso");
      if (actual.week !== week || actual.year !== year) {
        mismatches.push(`${date}: ${actual.year}-W${actual.week}`);
      }
      date = date.add({ days: 1 });
    }
    expect(mismatches).toEqual([]);
  });

  // Independent reference: 1 January is week 1, and each Sunday after it
  // starts the next week.
  it("US: counts a week at each Sunday for every day from 2000 to 2100", () => {
    const mismatches: string[] = [];
    let date = new CalendarDate(2000, 1, 1);
    const end = new CalendarDate(2100, 12, 31);
    let week = 1;
    while (date.compare(end) <= 0) {
      if (date.month === 1 && date.day === 1) week = 1;
      else if (getDayOfWeek(date, "en-US") === 0) week += 1;
      const actual = weekOfYear(date, "us");
      if (actual.week !== week || actual.year !== date.year) {
        mismatches.push(`${date}: ${actual.year}-W${actual.week}`);
      }
      date = date.add({ days: 1 });
    }
    expect(mismatches).toEqual([]);
  });
});

describe("yearFollowsWeek", () => {
  it.each([
    ["%{yy}%{ww}-", true],
    ["SN-%{yyyy}-W%{ww}-", true],
    ["%{ww}-%{hh}", true],
    ["%{yyyy}%{mm}%{dd}-W%{ww}-", false],
    ["%{yyyy}-%{mm}-W%{ww}", false],
    ["%{dd}%{ww}", false],
    ["JE-%{yyyy}-%{mm}-", false],
    ["", false]
  ])("%s: %s", (value, expected) => {
    expect(yearFollowsWeek(value)).toBe(expected);
  });
});

describe("asWeekNumbering", () => {
  it("reads a stored value, and anything else as ISO 8601", () => {
    expect(asWeekNumbering("us")).toBe("us");
    expect(asWeekNumbering("iso")).toBe("iso");
    expect(asWeekNumbering("ISO 8601")).toBe("iso");
    expect(asWeekNumbering(null)).toBe("iso");
  });
});

const url = process.env.SUPABASE_DB_URL;

describe.skipIf(!url)(
  "interpolate_sequence_date (SQL) against TypeScript",
  () => {
    const client = new Client({ connectionString: url });
    beforeAll(() => client.connect());
    afterAll(() => client.end());

    it("agrees on every day from 2000 to 2100, for both formats and systems", async () => {
      const { rows } = await client.query<{
        day: string;
        iso_date: string;
        iso_week: string;
        us_date: string;
        us_week: string;
      }>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day,
                interpolate_sequence_date($1, d + time '13:05:09', 'iso') AS iso_date,
                interpolate_sequence_date($2, d + time '13:05:09', 'iso') AS iso_week,
                interpolate_sequence_date($1, d + time '13:05:09', 'us') AS us_date,
                interpolate_sequence_date($2, d + time '13:05:09', 'us') AS us_week
         FROM generate_series('2000-01-01'::timestamp, '2100-12-31', '1 day') d`,
        [DATE_FORMAT, WEEK_FORMAT]
      );
      expect(rows).toHaveLength(36890);
      const mismatches = rows.filter((row) =>
        weekNumberings.some(
          (numbering) =>
            row[`${numbering}_date`] !==
              interpolateSequenceDate(DATE_FORMAT, {
                at: at(row.day, 13, 9),
                weekNumbering: numbering
              }) ||
            row[`${numbering}_week`] !==
              interpolateSequenceDate(WEEK_FORMAT, {
                at: at(row.day, 13, 9),
                weekNumbering: numbering
              })
        )
      );
      expect(mismatches).toEqual([]);
    });
  }
);
