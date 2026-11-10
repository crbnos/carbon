// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { round, SCALE } from "./precision.ts";
import {
  addDays,
  daysBetweenInclusive,
  daysInMonth,
  formatIsoDate,
  monthEnd,
  parseIsoDate,
  spreadStraightLine
} from "./revenue-schedule.ts";

const sum = (rows: { amount: number }[]) =>
  round(
    rows.reduce((total, row) => total + row.amount, 0),
    SCALE
  );

it("daysInMonth follows the Gregorian leap rule", () => {
  expect(daysInMonth(2028, 2)).toEqual(29);
  expect(daysInMonth(2100, 2)).toEqual(28);
  expect(daysInMonth(2000, 2)).toEqual(29);
  expect(daysInMonth(2026, 2)).toEqual(28);
  expect(
    Array.from({ length: 12 }, (_, index) => daysInMonth(2026, index + 1))
  ).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
});

it("parseIsoDate accepts only real YYYY-MM-DD calendar dates", () => {
  expect(parseIsoDate("2026-10-15")).toEqual({
    year: 2026,
    month: 10,
    day: 15
  });
  expect(formatIsoDate(2026, 3, 7)).toEqual("2026-03-07");
  for (const bad of [
    "2026-1-5",
    "10/15/2026",
    "2026-13-01",
    "2026-02-30",
    "2027-02-29",
    "2026-10-15T00:00:00Z",
    ""
  ]) {
    expect(() => parseIsoDate(bad)).toThrow(Error);
  }
});

it("monthEnd lands on the last day of the month, leap years included", () => {
  expect(monthEnd("2026-10-15")).toEqual("2026-10-31");
  expect(monthEnd("2026-11-01")).toEqual("2026-11-30");
  expect(monthEnd("2028-02-10")).toEqual("2028-02-29");
  expect(monthEnd("2100-02-10")).toEqual("2100-02-28");
});

it("daysBetweenInclusive counts both ends across years and leap days", () => {
  expect(daysBetweenInclusive("2026-10-15", "2026-10-15")).toEqual(1);
  expect(daysBetweenInclusive("2026-10-15", "2026-11-14")).toEqual(31);
  expect(daysBetweenInclusive("2026-12-31", "2027-01-01")).toEqual(2);
  expect(daysBetweenInclusive("2028-02-01", "2028-03-01")).toEqual(30);
  expect(daysBetweenInclusive("2026-01-01", "2026-12-31")).toEqual(365);
  expect(daysBetweenInclusive("2028-01-01", "2028-12-31")).toEqual(366);
  // 100 whole years with 25 leap days (2000 is one, 2100 is not).
  expect(daysBetweenInclusive("2000-01-01", "2099-12-31")).toEqual(36525);
  // One more day when the range reaches into the next century.
  expect(daysBetweenInclusive("2000-01-01", "2100-01-01")).toEqual(36526);
  expect(() => daysBetweenInclusive("2026-11-14", "2026-10-15")).toThrow(
    "before"
  );
});

it("addDays rolls over month and year boundaries in both directions", () => {
  expect(addDays("2026-10-31", 1)).toEqual("2026-11-01");
  expect(addDays("2026-12-31", 1)).toEqual("2027-01-01");
  expect(addDays("2028-02-28", 1)).toEqual("2028-02-29");
  expect(addDays("2026-02-28", 1)).toEqual("2026-03-01");
  expect(addDays("2026-03-01", -1)).toEqual("2026-02-28");
  expect(addDays("2027-01-01", -1)).toEqual("2026-12-31");
  expect(addDays("2026-10-15", 365)).toEqual("2027-10-15");
  expect(addDays("2026-10-15", 0)).toEqual("2026-10-15");
  expect(() => addDays("2026-10-15", 1.5)).toThrow(Error);
});

it("six whole months: one row per month, dated the month end, weighted by days", () => {
  const rows = spreadStraightLine({
    amount: 1200,
    startDate: "2026-10-01",
    endDate: "2027-03-31"
  });
  expect(rows.map((row) => row.scheduledDate)).toEqual([
    "2026-10-31",
    "2026-11-30",
    "2026-12-31",
    "2027-01-31",
    "2027-02-28",
    "2027-03-31"
  ]);
  expect(rows.map((row) => row.periodStart)).toEqual([
    "2026-10-01",
    "2026-11-01",
    "2026-12-01",
    "2027-01-01",
    "2027-02-01",
    "2027-03-01"
  ]);
  expect(rows.every((row) => row.periodEnd === row.scheduledDate)).toEqual(
    true
  );
  // 182 days at 1200/182 per day: a 31-day month carries more than a 30-day
  // one and February the least. Six equal months are NOT six equal amounts —
  // that would be an even-period method, a different weighting.
  expect(rows.map((row) => round(row.amount, 2))).toEqual([
    204.4, 197.8, 204.4, 204.4, 184.62, 204.4
  ]);
  // Independently rounded, these parts fall two minor units short of 1200 —
  // this case genuinely exercises the residual, so the exact sum is earned.
  const independentlyRounded = [31, 30, 31, 31, 28, 31]
    .map((days) => round((1200 * days) / 182))
    .reduce((total, value) => total + value, 0);
  expect(round(independentlyRounded, SCALE) !== 1200).toEqual(true);
  expect(sum(rows)).toEqual(1200);
});

it("a range inside one month is a single row for the whole amount", () => {
  expect(
    spreadStraightLine({
      amount: 1500,
      startDate: "2026-10-15",
      endDate: "2026-10-31"
    })
  ).toEqual([
    {
      periodStart: "2026-10-15",
      periodEnd: "2026-10-31",
      scheduledDate: "2026-10-31",
      amount: 1500
    }
  ]);
});

it("a range straddling a month end splits by days: 17 of 31, then 14 of 31", () => {
  const rows = spreadStraightLine({
    amount: 1500,
    startDate: "2026-10-15",
    endDate: "2026-11-14"
  });
  expect(
    rows.map(({ periodStart, periodEnd, scheduledDate }) => ({
      periodStart,
      periodEnd,
      scheduledDate
    }))
  ).toEqual([
    {
      periodStart: "2026-10-15",
      periodEnd: "2026-10-31",
      scheduledDate: "2026-10-31"
    },
    {
      periodStart: "2026-11-01",
      periodEnd: "2026-11-14",
      scheduledDate: "2026-11-14"
    }
  ]);
  // Rows carry internal scale, like the journal lines they become; at
  // settlement precision they read 822.58 and 677.42.
  expect(rows.map((row) => row.amount)).toEqual([822.58065, 677.41935]);
  expect(rows.map((row) => round(row.amount, 2))).toEqual([822.58, 677.42]);
  expect(sum(rows)).toEqual(1500);
});

it("a leap February weighs 29 days", () => {
  const rows = spreadStraightLine({
    amount: 600,
    startDate: "2028-02-01",
    endDate: "2028-03-31"
  });
  expect(rows.map((row) => [row.scheduledDate, row.amount])).toEqual([
    ["2028-02-29", 290],
    ["2028-03-31", 310]
  ]);
});

it("an awkward amount over partial months still sums exactly to the input", () => {
  const rows = spreadStraightLine({
    amount: 1000,
    startDate: "2026-01-10",
    endDate: "2026-04-05"
  });
  expect(rows.map((row) => [row.periodStart, row.periodEnd])).toEqual([
    ["2026-01-10", "2026-01-31"],
    ["2026-02-01", "2026-02-28"],
    ["2026-03-01", "2026-03-31"],
    ["2026-04-01", "2026-04-05"]
  ]);
  // 22 + 28 + 31 + 5 = 86 days; every row within one minor unit of its share.
  const exact = [22, 28, 31, 5].map((days) => (1000 * days) / 86);
  for (const [index, row] of rows.entries()) {
    expect(Math.abs(row.amount - exact[index]!) <= 0.00001).toEqual(true);
  }
  expect(sum(rows)).toEqual(1000);
});

it("negative and zero amounts spread the same way (a credit memo's deferral)", () => {
  const credit = spreadStraightLine({
    amount: -1500,
    startDate: "2026-10-15",
    endDate: "2026-11-14"
  });
  expect(credit.map((row) => row.amount)).toEqual([-822.58065, -677.41935]);
  expect(sum(credit)).toEqual(-1500);
  const nothing = spreadStraightLine({
    amount: 0,
    startDate: "2026-10-15",
    endDate: "2026-11-14"
  });
  expect(nothing.map((row) => row.amount)).toEqual([0, 0]);
});

it("refuses a range that ends before it starts, a malformed date, or a non-finite amount", () => {
  expect(() =>
    spreadStraightLine({
      amount: 100,
      startDate: "2026-11-14",
      endDate: "2026-10-15"
    })
  ).toThrow("before");
  expect(() =>
    spreadStraightLine({
      amount: 100,
      startDate: "2026-10-15",
      endDate: "2026-11-31"
    })
  ).toThrow("calendar");
  expect(() =>
    spreadStraightLine({
      amount: 100,
      startDate: "10/15/2026",
      endDate: "2026-11-14"
    })
  ).toThrow("YYYY-MM-DD");
  expect(() =>
    spreadStraightLine({
      amount: Number.NaN,
      startDate: "2026-10-15",
      endDate: "2026-11-14"
    })
  ).toThrow("finite");
  expect(() =>
    spreadStraightLine({
      amount: Number.POSITIVE_INFINITY,
      startDate: "2026-10-15",
      endDate: "2026-11-14"
    })
  ).toThrow("finite");
});
