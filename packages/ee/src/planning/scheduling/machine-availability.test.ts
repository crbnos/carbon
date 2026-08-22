import {
  fromAbsolute,
  getDayOfWeek,
  parseAbsolute,
  toCalendarDate
} from "@internationalized/date";
import { it } from "vitest";
import { intersectWindows, subtractIntervals } from "./calendar-utils.ts";
import {
  type LadderShiftRow,
  resolveLocationWindows,
  resolveWorkCenterWindows,
  type WorkCenterAvailabilityInput
} from "./machine-availability.ts";
import { assert, assertEquals } from "./test-helpers.ts";

const utc = (iso: string) => parseAbsolute(iso, "UTC").toDate().getTime();

// 2026-01-05 is a Monday; the range covers one full week.
const RANGE_START = utc("2026-01-05T00:00:00Z");
const RANGE_END = utc("2026-01-12T00:00:00Z");

const wc = (
  id: string,
  overrides: Partial<WorkCenterAvailabilityInput> = {}
): WorkCenterAvailabilityInput => ({
  id,
  alwaysOn: false,
  locationId: "loc1",
  timezone: "UTC",
  ...overrides
});

// Mon–Fri "HH:MM"–"HH:MM" ladder rows for a given work center / location.
const weekdayRows = <T extends Record<string, string>>(
  extra: T,
  startTime: string,
  endTime: string
): (LadderShiftRow & T)[] =>
  [1, 2, 3, 4, 5].map((dayOfWeek) => ({
    ...extra,
    dayOfWeek,
    startTime,
    endTime,
    timezone: "UTC"
  }));

it("ladder rung 1: two work-center shifts union into one 06:00–22:00 window/day", () => {
  const map = resolveWorkCenterWindows({
    workCenters: [wc("w1")],
    workCenterShiftRows: [
      ...weekdayRows({ workCenterId: "w1" }, "06:00", "14:00"),
      ...weekdayRows({ workCenterId: "w1" }, "14:00", "22:00")
    ],
    locationShiftRows: [],
    rangeStart: RANGE_START,
    rangeEnd: RANGE_END
  });
  const windows = map.get("w1")!;
  assertEquals(windows.length, 5); // Mon–Fri, weekend excluded
  assertEquals(windows[0]?.start, utc("2026-01-05T06:00:00.000Z"));
  assertEquals(windows[0]?.end, utc("2026-01-05T22:00:00.000Z"));
});

it("ladder rung 2: no WC shifts falls through to the location's shifts", () => {
  const map = resolveWorkCenterWindows({
    workCenters: [wc("w1")],
    workCenterShiftRows: [],
    locationShiftRows: weekdayRows({ locationId: "loc1" }, "09:00", "17:00"),
    rangeStart: RANGE_START,
    rangeEnd: RANGE_END
  });
  const windows = map.get("w1")!;
  assertEquals(windows.length, 5);
  assertEquals(windows[0]?.start, utc("2026-01-05T09:00:00.000Z"));
  assertEquals(windows[0]?.end, utc("2026-01-05T17:00:00.000Z"));
});

it("ladder rung 3: no shifts anywhere → stock Mon–Fri 08:00–16:00, none on the weekend", () => {
  const map = resolveWorkCenterWindows({
    workCenters: [wc("w1")],
    workCenterShiftRows: [],
    locationShiftRows: [],
    rangeStart: RANGE_START,
    rangeEnd: RANGE_END
  });
  const windows = map.get("w1")!;
  assertEquals(windows.length, 5); // Mon–Fri only
  assertEquals(windows[0]?.start, utc("2026-01-05T08:00:00.000Z"));
  assertEquals(windows[0]?.end, utc("2026-01-05T16:00:00.000Z"));
  // Saturday 2026-01-10 / Sunday 2026-01-11 produce no windows
  for (const w of windows) {
    const day = getDayOfWeek(
      toCalendarDate(fromAbsolute(w.start, "UTC")),
      "en-US"
    );
    assert(day >= 1 && day <= 5, `unexpected weekend window on day ${day}`);
  }
});

it("ladder rung 3 honors the location timezone", () => {
  const map = resolveWorkCenterWindows({
    workCenters: [wc("w1", { timezone: "America/New_York" })],
    workCenterShiftRows: [],
    locationShiftRows: [],
    rangeStart: RANGE_START,
    rangeEnd: RANGE_END
  });
  const windows = map.get("w1")!;
  // 08:00 America/New_York on 2026-01-05 = 13:00 UTC (EST, UTC-5);
  // 16:00 local = 21:00 UTC.
  assertEquals(windows[0]?.start, utc("2026-01-05T13:00:00.000Z"));
  assertEquals(windows[0]?.end, utc("2026-01-05T21:00:00.000Z"));
});

it("ladder: alwaysOn machine is one continuous window across the range", () => {
  const map = resolveWorkCenterWindows({
    workCenters: [wc("w1", { alwaysOn: true })],
    workCenterShiftRows: weekdayRows({ workCenterId: "w1" }, "06:00", "14:00"),
    locationShiftRows: weekdayRows({ locationId: "loc1" }, "09:00", "17:00"),
    rangeStart: RANGE_START,
    rangeEnd: RANGE_END
  });
  const windows = map.get("w1")!;
  assertEquals(windows.length, 1);
  assertEquals(windows[0]?.start, RANGE_START);
  assertEquals(windows[0]?.end, RANGE_END);
});

it("ladder: WC shifts win over location shifts (rung 1 before rung 2)", () => {
  const map = resolveWorkCenterWindows({
    workCenters: [wc("w1")],
    workCenterShiftRows: weekdayRows({ workCenterId: "w1" }, "06:00", "14:00"),
    locationShiftRows: weekdayRows({ locationId: "loc1" }, "09:00", "17:00"),
    rangeStart: RANGE_START,
    rangeEnd: RANGE_END
  });
  const windows = map.get("w1")!;
  assertEquals(windows[0]?.start, utc("2026-01-05T06:00:00.000Z"));
  assertEquals(windows[0]?.end, utc("2026-01-05T14:00:00.000Z"));
});

it("resolveLocationWindows: shifts if present, else the stock week", () => {
  const withShifts = resolveLocationWindows({
    timezone: "UTC",
    locationShiftRows: weekdayRows({}, "07:00", "15:00"),
    rangeStart: RANGE_START,
    rangeEnd: RANGE_END
  });
  assertEquals(withShifts.length, 5);
  assertEquals(withShifts[0]?.start, utc("2026-01-05T07:00:00.000Z"));

  const stock = resolveLocationWindows({
    timezone: "UTC",
    locationShiftRows: [],
    rangeStart: RANGE_START,
    rangeEnd: RANGE_END
  });
  assertEquals(stock.length, 5);
  assertEquals(stock[0]?.start, utc("2026-01-05T08:00:00.000Z"));
  assertEquals(stock[0]?.end, utc("2026-01-05T16:00:00.000Z"));
});

it("intersectWindows: overlap keeps the shared span", () => {
  const out = intersectWindows(
    [{ start: utc("2026-01-05T08:00:00Z"), end: utc("2026-01-05T16:00:00Z") }],
    [{ start: utc("2026-01-05T12:00:00Z"), end: utc("2026-01-05T20:00:00Z") }]
  );
  assertEquals(out.length, 1);
  assertEquals(out[0]?.start, utc("2026-01-05T12:00:00.000Z"));
  assertEquals(out[0]?.end, utc("2026-01-05T16:00:00.000Z"));
});

it("intersectWindows: containment keeps the inner window", () => {
  const out = intersectWindows(
    [{ start: utc("2026-01-05T00:00:00Z"), end: utc("2026-01-06T00:00:00Z") }],
    [{ start: utc("2026-01-05T09:00:00Z"), end: utc("2026-01-05T17:00:00Z") }]
  );
  assertEquals(out.length, 1);
  assertEquals(out[0]?.start, utc("2026-01-05T09:00:00.000Z"));
  assertEquals(out[0]?.end, utc("2026-01-05T17:00:00.000Z"));
});

it("intersectWindows: disjoint windows produce nothing", () => {
  const out = intersectWindows(
    [{ start: utc("2026-01-05T08:00:00Z"), end: utc("2026-01-05T10:00:00Z") }],
    [{ start: utc("2026-01-05T12:00:00Z"), end: utc("2026-01-05T14:00:00Z") }]
  );
  assertEquals(out.length, 0);
});

// --- machine downtime (subtractIntervals) -----------------------------------

it("downtime: an outage with a planned end splits a day's window in two", () => {
  const day = [
    { start: utc("2026-01-05T08:00:00Z"), end: utc("2026-01-05T16:00:00Z") }
  ];
  // Dispatch offline 10:00–12:00
  const out = subtractIntervals(day, [
    { start: utc("2026-01-05T10:00:00Z"), end: utc("2026-01-05T12:00:00Z") }
  ]);
  assertEquals(out.length, 2);
  assertEquals(out[0]?.start, utc("2026-01-05T08:00:00.000Z"));
  assertEquals(out[0]?.end, utc("2026-01-05T10:00:00.000Z"));
  assertEquals(out[1]?.start, utc("2026-01-05T12:00:00.000Z"));
  assertEquals(out[1]?.end, utc("2026-01-05T16:00:00.000Z"));
});

it("downtime: an open-ended outage empties the week's windows to the horizon", () => {
  const week = [
    { start: utc("2026-01-05T08:00:00Z"), end: utc("2026-01-05T16:00:00Z") },
    { start: utc("2026-01-06T08:00:00Z"), end: utc("2026-01-06T16:00:00Z") }
  ];
  // No end estimate → outage runs to the horizon (2026-02-05)
  const out = subtractIntervals(week, [
    { start: utc("2026-01-05T00:00:00Z"), end: utc("2026-02-05T00:00:00Z") }
  ]);
  assertEquals(out.length, 0);
});

it("downtime: no outages (e.g. a Completed dispatch) leaves the windows unchanged", () => {
  const week = [
    { start: utc("2026-01-05T08:00:00Z"), end: utc("2026-01-05T16:00:00Z") }
  ];
  const out = subtractIntervals(week, []);
  assertEquals(out.length, 1);
  assertEquals(out[0]?.start, utc("2026-01-05T08:00:00.000Z"));
  assertEquals(out[0]?.end, utc("2026-01-05T16:00:00.000Z"));
});

it("downtime: multiple outages in one window split it into the gaps", () => {
  const day = [
    { start: utc("2026-01-05T08:00:00Z"), end: utc("2026-01-05T18:00:00Z") }
  ];
  const out = subtractIntervals(day, [
    { start: utc("2026-01-05T09:00:00Z"), end: utc("2026-01-05T10:00:00Z") },
    { start: utc("2026-01-05T14:00:00Z"), end: utc("2026-01-05T15:00:00Z") }
  ]);
  assertEquals(out.length, 3);
  assertEquals(out[0]?.end, utc("2026-01-05T09:00:00.000Z"));
  assertEquals(out[1]?.start, utc("2026-01-05T10:00:00.000Z"));
  assertEquals(out[1]?.end, utc("2026-01-05T14:00:00.000Z"));
  assertEquals(out[2]?.start, utc("2026-01-05T15:00:00.000Z"));
});

it("intersectWindows: multi-window sweep intersects each overlap once", () => {
  const machine = [
    { start: utc("2026-01-05T08:00:00Z"), end: utc("2026-01-05T16:00:00Z") },
    { start: utc("2026-01-06T08:00:00Z"), end: utc("2026-01-06T16:00:00Z") }
  ];
  const person = [
    { start: utc("2026-01-05T12:00:00Z"), end: utc("2026-01-06T12:00:00Z") }
  ];
  const out = intersectWindows(machine, person);
  assertEquals(out.length, 2);
  assertEquals(out[0]?.start, utc("2026-01-05T12:00:00.000Z"));
  assertEquals(out[0]?.end, utc("2026-01-05T16:00:00.000Z"));
  assertEquals(out[1]?.start, utc("2026-01-06T08:00:00.000Z"));
  assertEquals(out[1]?.end, utc("2026-01-06T12:00:00.000Z"));
});
