import { fromAbsolute, parseAbsolute } from "@internationalized/date";
import { it } from "vitest";
import {
  countOverlaps,
  expandCalendar,
  findSlot,
  unionWindows
} from "./calendar-utils.ts";
import { assert, assertEquals } from "./test-helpers.ts";

const utc = (iso: string) => parseAbsolute(iso, "UTC").toDate().getTime();
const iso = (ms: number) => fromAbsolute(ms, "UTC").toAbsoluteString();

// 2026-01-05 is a Monday
const RANGE_START = utc("2026-01-05T00:00:00Z");
const RANGE_END = utc("2026-01-12T00:00:00Z");

const weekdayShifts = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  startTime: "08:00",
  endTime: "16:00"
}));

it("expandCalendar: weekly pattern produces one window per matching day", () => {
  const windows = expandCalendar(weekdayShifts, RANGE_START, RANGE_END);

  assertEquals(windows.length, 5); // Mon-Fri, weekend excluded
  assertEquals(windows[0]?.start, utc("2026-01-05T08:00:00.000Z"));
  assertEquals(windows[0]?.end, utc("2026-01-05T16:00:00.000Z"));
  assertEquals(windows[4]?.start, utc("2026-01-09T08:00:00.000Z"));
});

it("expandCalendar: overlapping shift rows merge into one window", () => {
  const windows = expandCalendar(
    [
      { dayOfWeek: 1, startTime: "08:00", endTime: "12:00" },
      { dayOfWeek: 1, startTime: "11:00", endTime: "16:00" }
    ],
    RANGE_START,
    RANGE_END
  );

  assertEquals(windows.length, 1);
  assertEquals(windows[0]?.start, utc("2026-01-05T08:00:00.000Z"));
  assertEquals(windows[0]?.end, utc("2026-01-05T16:00:00.000Z"));
});

it("expandCalendar: overnight shift rolls into the next day", () => {
  const windows = expandCalendar(
    [{ dayOfWeek: 1, startTime: "22:00", endTime: "06:00" }],
    RANGE_START,
    RANGE_END
  );

  assertEquals(windows.length, 1);
  assertEquals(windows[0]?.start, utc("2026-01-05T22:00:00.000Z"));
  assertEquals(windows[0]?.end, utc("2026-01-06T06:00:00.000Z"));
});

it("expandCalendar: empty shifts => one 24x7 window (always available)", () => {
  const windows = expandCalendar([], RANGE_START, RANGE_END);
  assertEquals(windows.length, 1);
  assertEquals(windows[0]?.start, RANGE_START);
  assertEquals(windows[0]?.end, RANGE_END);
});

it("expandCalendar: timezone shifts resolve to correct UTC across DST", () => {
  // US DST spring-forward 2026-03-08. New York is UTC-5 before, UTC-4 after.
  const windows = expandCalendar(
    weekdayShifts,
    utc("2026-03-05T00:00:00Z"),
    utc("2026-03-12T00:00:00Z"),
    "America/New_York"
  );

  const thu = windows.find((w) => iso(w.start).startsWith("2026-03-05"));
  const tue = windows.find((w) => iso(w.start).startsWith("2026-03-10"));
  assert(thu && tue);
  assertEquals(thu.start, utc("2026-03-05T13:00:00.000Z")); // UTC-5
  assertEquals(tue.start, utc("2026-03-10T12:00:00.000Z")); // UTC-4
});

it("unionWindows: merges member availability into disjoint windows", () => {
  const a = [
    { start: utc("2026-01-05T08:00:00Z"), end: utc("2026-01-05T12:00:00Z") }
  ];
  const b = [
    { start: utc("2026-01-05T10:00:00Z"), end: utc("2026-01-05T16:00:00Z") },
    { start: utc("2026-01-06T08:00:00Z"), end: utc("2026-01-06T12:00:00Z") }
  ];

  const union = unionWindows([a, b]);
  assertEquals(union.length, 2);
  assertEquals(union[0]?.start, utc("2026-01-05T08:00:00.000Z"));
  assertEquals(union[0]?.end, utc("2026-01-05T16:00:00.000Z"));
  assertEquals(union[1]?.start, utc("2026-01-06T08:00:00.000Z"));
});

it("countOverlaps: counts reservations overlapping the interval", () => {
  const reservations = [
    {
      startAt: utc("2026-01-05T08:00:00Z"),
      endAt: utc("2026-01-05T10:00:00Z")
    },
    {
      startAt: utc("2026-01-05T09:00:00Z"),
      endAt: utc("2026-01-05T11:00:00Z")
    },
    {
      startAt: utc("2026-01-05T12:00:00Z"),
      endAt: utc("2026-01-05T13:00:00Z")
    }
  ];

  assertEquals(
    countOverlaps(
      reservations,
      utc("2026-01-05T09:30:00Z"),
      utc("2026-01-05T09:31:00Z")
    ),
    2
  );
  assertEquals(
    countOverlaps(
      reservations,
      utc("2026-01-05T11:00:00Z"),
      utc("2026-01-05T12:00:00Z")
    ),
    0 // boundaries are exclusive
  );
});

// Two weeks of weekday windows for slot-walking tests
const weekdayWindows = expandCalendar(
  weekdayShifts,
  RANGE_START,
  utc("2026-01-19T00:00:00Z")
);

it("findSlot: places at earliestStart when free", () => {
  const slot = findSlot({
    windows: weekdayWindows,
    durationHours: 4,
    earliestStart: utc("2026-01-05T09:00:00Z"),
    isFree: () => ({ free: true })
  });

  assert(slot);
  assertEquals(slot.start, utc("2026-01-05T09:00:00.000Z"));
  assertEquals(slot.end, utc("2026-01-05T13:00:00.000Z"));
});

it("findSlot: accumulates working time across windows (gap does not count)", () => {
  // 10h starting Fri 08:00: 8h Friday + 2h Monday (weekend is a gap)
  const slot = findSlot({
    windows: weekdayWindows,
    durationHours: 10,
    earliestStart: utc("2026-01-09T08:00:00Z"),
    isFree: () => ({ free: true })
  });

  assert(slot);
  assertEquals(slot.start, utc("2026-01-09T08:00:00.000Z"));
  assertEquals(slot.end, utc("2026-01-12T10:00:00.000Z"));
});

it("findSlot: honors nextTryAfter rejection hints", () => {
  const busyUntil = utc("2026-01-05T12:00:00Z");
  const slot = findSlot({
    windows: weekdayWindows,
    durationHours: 2,
    earliestStart: utc("2026-01-05T08:00:00Z"),
    isFree: (start) =>
      start < busyUntil
        ? { free: false, nextTryAfter: busyUntil }
        : { free: true }
  });

  assert(slot);
  assertEquals(slot.start, utc("2026-01-05T12:00:00.000Z"));
});

it("findSlot: returns null when the horizon is exhausted", () => {
  const slot = findSlot({
    windows: weekdayWindows,
    durationHours: 500, // cannot fit in two weeks of 8h days
    earliestStart: utc("2026-01-05T08:00:00Z"),
    isFree: () => ({ free: true })
  });

  assertEquals(slot, null);
});
