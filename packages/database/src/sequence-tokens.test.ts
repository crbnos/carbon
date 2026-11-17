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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  interpolateSequenceDate,
  isoWeek,
  usesCalendarYearForWeek
} from "./sequence-tokens.ts";

const at = (date: string, hour = 13, second = 9) => {
  const { year, month, day } = parseDate(date);
  return toZoned(
    new CalendarDateTime(year, month, day, hour, 5, second),
    "UTC"
  );
};

const ALL_TOKENS =
  "%{yyyy}|%{yy}|%{wyyyy}|%{wyy}|%{mm}|%{ww}|%{dd}|%{hh}|%{ss}";

describe("interpolateSequenceDate", () => {
  // Every case a calendar year and its ISO week disagree on, either side of
  // a new year, plus a day where they agree.
  it.each([
    ["2024-12-30", "Mon", "2401", "2501", "2024-W01", "2025-W01"],
    ["2024-12-31", "Tue", "2401", "2501", "2024-W01", "2025-W01"],
    ["2025-12-29", "Mon", "2501", "2601", "2025-W01", "2026-W01"],
    ["2026-12-28", "Mon", "2653", "2653", "2026-W53", "2026-W53"],
    ["2026-12-31", "Thu", "2653", "2653", "2026-W53", "2026-W53"],
    ["2027-01-01", "Fri", "2753", "2653", "2027-W53", "2026-W53"],
    ["2027-01-02", "Sat", "2753", "2653", "2027-W53", "2026-W53"],
    ["2027-01-03", "Sun", "2753", "2653", "2027-W53", "2026-W53"],
    ["2027-01-04", "Mon", "2701", "2701", "2027-W01", "2027-W01"],
    ["2021-01-03", "Sun", "2153", "2053", "2021-W53", "2020-W53"],
    ["2026-11-18", "Wed", "2647", "2647", "2026-W47", "2026-W47"]
  ])(
    "%s (%s): %{yy}%{ww} is %s, %{wyy}%{ww} is %s",
    (date, _day, calendar, week, calendarLong, weekLong) => {
      expect(interpolateSequenceDate("%{yy}%{ww}", "UTC", at(date))).toBe(
        calendar
      );
      expect(interpolateSequenceDate("%{wyy}%{ww}", "UTC", at(date))).toBe(
        week
      );
      expect(interpolateSequenceDate("%{yyyy}-W%{ww}", "UTC", at(date))).toBe(
        calendarLong
      );
      expect(interpolateSequenceDate("%{wyyyy}-W%{ww}", "UTC", at(date))).toBe(
        weekLong
      );
    }
  );

  it("fills every token, padded to two digits", () => {
    expect(
      interpolateSequenceDate(ALL_TOKENS, "UTC", at("2027-01-01", 7, 3))
    ).toBe("2027|27|2026|26|01|53|01|07|03");
  });

  it("uses the wall clock of the zone it is given", () => {
    // 12:00 UTC on 31 December 2026 is already 1 January 2027 in Auckland.
    const auckland = parseAbsolute("2026-12-31T12:00:00Z", "Pacific/Auckland");
    expect(
      interpolateSequenceDate("%{yyyy}-%{mm}-%{dd} %{hh}", "UTC", auckland)
    ).toBe("2027-01-01 01");
    expect(interpolateSequenceDate("%{wyy}%{ww}", "UTC", auckland)).toBe(
      "2653"
    );
  });

  it("leaves text and unknown tokens as written", () => {
    expect(interpolateSequenceDate("SO-", "UTC", at("2027-01-01"))).toBe("SO-");
    expect(
      interpolateSequenceDate("%{location}-%{wyy}", "UTC", at("2027-01-01"))
    ).toBe("%{location}-26");
    expect(interpolateSequenceDate(null)).toBe("");
    expect(interpolateSequenceDate("")).toBe("");
  });
});

describe("isoWeek", () => {
  // Reference rule, independent of isoWeek's: week 1 is the week of 4 January,
  // and a week runs Monday to Sunday.
  const mondayOf = (date: CalendarDate) =>
    date.subtract({ days: getDayOfWeek(date, "en-GB") });

  it("matches the 4 January rule for every day from 2000 to 2100", () => {
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
        Math.floor(
          mondayOf(date).compare(mondayOf(new CalendarDate(year, 1, 4))) / 7
        ) + 1;
      const actual = isoWeek(date);
      if (actual.week !== week || actual.year !== year) {
        mismatches.push(`${date}: ${actual.year}-W${actual.week}`);
      }
      date = date.add({ days: 1 });
    }
    expect(mismatches).toEqual([]);
  });
});

describe("usesCalendarYearForWeek", () => {
  it.each([
    ["%{yy}%{ww}-", null, true],
    ["SN-%{yyyy}-W%{ww}-", "", true],
    ["%{ww}", "-%{yy}", true],
    ["%{wyy}%{ww}-", null, false],
    ["%{wyyyy}-W%{ww}-", null, false],
    ["%{yyyy}-", "-%{wyy}%{ww}", false],
    ["%{yy}-%{wyyyy}W%{ww}", null, false],
    ["%{yyyy}%{mm}%{dd}-W%{ww}-", null, false],
    ["%{yyyy}-%{mm}-W%{ww}", null, false],
    ["JE-%{yyyy}-%{mm}-", null, false],
    ["%{ww}-", null, false],
    [null, null, false]
  ])("%s / %s: %s", (prefix, suffix, expected) => {
    expect(usesCalendarYearForWeek(prefix, suffix)).toBe(expected);
  });
});

const url = process.env.SUPABASE_DB_URL;

describe.skipIf(!url)(
  "interpolate_sequence_date (SQL) against TypeScript",
  () => {
    const client = new Client({ connectionString: url });
    beforeAll(() => client.connect());
    afterAll(() => client.end());

    it("agrees on every day from 2000 to 2100", async () => {
      const { rows } = await client.query<{ day: string; value: string }>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day,
              interpolate_sequence_date($1, d + time '13:05:09') AS value
       FROM generate_series('2000-01-01'::timestamp, '2100-12-31', '1 day') d`,
        [ALL_TOKENS]
      );
      expect(rows).toHaveLength(36890);
      const mismatches = rows.filter(
        ({ day, value }) =>
          value !== interpolateSequenceDate(ALL_TOKENS, "UTC", at(day, 13, 9))
      );
      expect(mismatches).toEqual([]);
    });
  }
);
