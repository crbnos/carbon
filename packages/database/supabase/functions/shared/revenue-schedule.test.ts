import {
  assertEquals,
  assertThrows
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
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

Deno.test("daysInMonth follows the Gregorian leap rule", () => {
  assertEquals(daysInMonth(2028, 2), 29);
  assertEquals(daysInMonth(2100, 2), 28);
  assertEquals(daysInMonth(2000, 2), 29);
  assertEquals(daysInMonth(2026, 2), 28);
  assertEquals(
    Array.from({ length: 12 }, (_, index) => daysInMonth(2026, index + 1)),
    [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  );
});

Deno.test("parseIsoDate accepts only real YYYY-MM-DD calendar dates", () => {
  assertEquals(parseIsoDate("2026-10-15"), { year: 2026, month: 10, day: 15 });
  assertEquals(formatIsoDate(2026, 3, 7), "2026-03-07");
  for (const bad of [
    "2026-1-5",
    "10/15/2026",
    "2026-13-01",
    "2026-02-30",
    "2027-02-29",
    "2026-10-15T00:00:00Z",
    ""
  ]) {
    assertThrows(() => parseIsoDate(bad), Error);
  }
});

Deno.test("monthEnd lands on the last day of the month, leap years included", () => {
  assertEquals(monthEnd("2026-10-15"), "2026-10-31");
  assertEquals(monthEnd("2026-11-01"), "2026-11-30");
  assertEquals(monthEnd("2028-02-10"), "2028-02-29");
  assertEquals(monthEnd("2100-02-10"), "2100-02-28");
});

Deno.test("daysBetweenInclusive counts both ends across years and leap days", () => {
  assertEquals(daysBetweenInclusive("2026-10-15", "2026-10-15"), 1);
  assertEquals(daysBetweenInclusive("2026-10-15", "2026-11-14"), 31);
  assertEquals(daysBetweenInclusive("2026-12-31", "2027-01-01"), 2);
  assertEquals(daysBetweenInclusive("2028-02-01", "2028-03-01"), 30);
  assertEquals(daysBetweenInclusive("2026-01-01", "2026-12-31"), 365);
  assertEquals(daysBetweenInclusive("2028-01-01", "2028-12-31"), 366);
  // 100 whole years with 25 leap days (2000 is one, 2100 is not).
  assertEquals(daysBetweenInclusive("2000-01-01", "2099-12-31"), 36525);
  // One more day when the range reaches into the next century.
  assertEquals(daysBetweenInclusive("2000-01-01", "2100-01-01"), 36526);
  assertThrows(
    () => daysBetweenInclusive("2026-11-14", "2026-10-15"),
    Error,
    "before"
  );
});

Deno.test("addDays rolls over month and year boundaries in both directions", () => {
  assertEquals(addDays("2026-10-31", 1), "2026-11-01");
  assertEquals(addDays("2026-12-31", 1), "2027-01-01");
  assertEquals(addDays("2028-02-28", 1), "2028-02-29");
  assertEquals(addDays("2026-02-28", 1), "2026-03-01");
  assertEquals(addDays("2026-03-01", -1), "2026-02-28");
  assertEquals(addDays("2027-01-01", -1), "2026-12-31");
  assertEquals(addDays("2026-10-15", 365), "2027-10-15");
  assertEquals(addDays("2026-10-15", 0), "2026-10-15");
  assertThrows(() => addDays("2026-10-15", 1.5), Error);
});

Deno.test("six whole months: one row per month, dated the month end, weighted by days", () => {
  const rows = spreadStraightLine({
    amount: 1200,
    startDate: "2026-10-01",
    endDate: "2027-03-31"
  });
  assertEquals(
    rows.map((row) => row.scheduledDate),
    ["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31"]
  );
  assertEquals(
    rows.map((row) => row.periodStart),
    ["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01"]
  );
  assertEquals(rows.every((row) => row.periodEnd === row.scheduledDate), true);
  // 182 days at 1200/182 per day: a 31-day month carries more than a 30-day
  // one and February the least. Six equal months are NOT six equal amounts —
  // that would be an even-period method, a different weighting.
  assertEquals(
    rows.map((row) => round(row.amount, 2)),
    [204.4, 197.8, 204.4, 204.4, 184.62, 204.4]
  );
  // Independently rounded, these parts fall two minor units short of 1200 —
  // this case genuinely exercises the residual, so the exact sum is earned.
  const independentlyRounded = [31, 30, 31, 31, 28, 31]
    .map((days) => round((1200 * days) / 182))
    .reduce((total, value) => total + value, 0);
  assertEquals(round(independentlyRounded, SCALE) !== 1200, true);
  assertEquals(sum(rows), 1200);
});

Deno.test("a range inside one month is a single row for the whole amount", () => {
  assertEquals(
    spreadStraightLine({
      amount: 1500,
      startDate: "2026-10-15",
      endDate: "2026-10-31"
    }),
    [
      {
        periodStart: "2026-10-15",
        periodEnd: "2026-10-31",
        scheduledDate: "2026-10-31",
        amount: 1500
      }
    ]
  );
});

Deno.test("a range straddling a month end splits by days: 17 of 31, then 14 of 31", () => {
  const rows = spreadStraightLine({
    amount: 1500,
    startDate: "2026-10-15",
    endDate: "2026-11-14"
  });
  assertEquals(
    rows.map(({ periodStart, periodEnd, scheduledDate }) => ({
      periodStart,
      periodEnd,
      scheduledDate
    })),
    [
      { periodStart: "2026-10-15", periodEnd: "2026-10-31", scheduledDate: "2026-10-31" },
      { periodStart: "2026-11-01", periodEnd: "2026-11-14", scheduledDate: "2026-11-14" }
    ]
  );
  // Rows carry internal scale, like the journal lines they become; at
  // settlement precision they read 822.58 and 677.42.
  assertEquals(rows.map((row) => row.amount), [822.58065, 677.41935]);
  assertEquals(rows.map((row) => round(row.amount, 2)), [822.58, 677.42]);
  assertEquals(sum(rows), 1500);
});

Deno.test("a leap February weighs 29 days", () => {
  const rows = spreadStraightLine({
    amount: 600,
    startDate: "2028-02-01",
    endDate: "2028-03-31"
  });
  assertEquals(
    rows.map((row) => [row.scheduledDate, row.amount]),
    [["2028-02-29", 290], ["2028-03-31", 310]]
  );
});

Deno.test("an awkward amount over partial months still sums exactly to the input", () => {
  const rows = spreadStraightLine({
    amount: 1000,
    startDate: "2026-01-10",
    endDate: "2026-04-05"
  });
  assertEquals(
    rows.map((row) => [row.periodStart, row.periodEnd]),
    [
      ["2026-01-10", "2026-01-31"],
      ["2026-02-01", "2026-02-28"],
      ["2026-03-01", "2026-03-31"],
      ["2026-04-01", "2026-04-05"]
    ]
  );
  // 22 + 28 + 31 + 5 = 86 days; every row within one minor unit of its share.
  const exact = [22, 28, 31, 5].map((days) => (1000 * days) / 86);
  for (const [index, row] of rows.entries()) {
    assertEquals(Math.abs(row.amount - exact[index]!) <= 0.00001, true);
  }
  assertEquals(sum(rows), 1000);
});

Deno.test("negative and zero amounts spread the same way (a credit memo's deferral)", () => {
  const credit = spreadStraightLine({
    amount: -1500,
    startDate: "2026-10-15",
    endDate: "2026-11-14"
  });
  assertEquals(credit.map((row) => row.amount), [-822.58065, -677.41935]);
  assertEquals(sum(credit), -1500);
  const nothing = spreadStraightLine({
    amount: 0,
    startDate: "2026-10-15",
    endDate: "2026-11-14"
  });
  assertEquals(nothing.map((row) => row.amount), [0, 0]);
});

Deno.test("refuses a range that ends before it starts, a malformed date, or a non-finite amount", () => {
  assertThrows(
    () => spreadStraightLine({ amount: 100, startDate: "2026-11-14", endDate: "2026-10-15" }),
    Error,
    "before"
  );
  assertThrows(
    () => spreadStraightLine({ amount: 100, startDate: "2026-10-15", endDate: "2026-11-31" }),
    Error,
    "calendar"
  );
  assertThrows(
    () => spreadStraightLine({ amount: 100, startDate: "10/15/2026", endDate: "2026-11-14" }),
    Error,
    "YYYY-MM-DD"
  );
  assertThrows(
    () => spreadStraightLine({ amount: Number.NaN, startDate: "2026-10-15", endDate: "2026-11-14" }),
    Error,
    "finite"
  );
  assertThrows(
    () =>
      spreadStraightLine({
        amount: Number.POSITIVE_INFINITY,
        startDate: "2026-10-15",
        endDate: "2026-11-14"
      }),
    Error,
    "finite"
  );
});
