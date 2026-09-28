import { CalendarDateTime } from "@internationalized/date";
import { it } from "vitest";
import type { CalendarWindow } from "./calendar-utils.ts";
import {
  buildAbsencesByEmployee,
  buildAssignmentsByEmployee,
  buildOvertimeByEmployee,
  buildPeopleBudgets,
  buildPeopleByWorkCenter,
  clipWindowsToDates,
  clipWindowsToStation,
  dateKeyInTimeZone,
  extendWindowsByOvertime,
  subtractAbsences,
  subtractDates
} from "./people-utils.ts";
import { assertEquals, assertStrictEquals } from "./test-helpers.ts";

const TZ = "America/Chicago"; // UTC-6 (CST) / UTC-5 (CDT)

// January (CST, UTC-6): local midnight = 06:00Z
const jan6amUTC = (day: number, hour = 0) =>
  new CalendarDateTime(2026, 1, day, hour).toDate("UTC").getTime();

const win = (start: number, end: number): CalendarWindow => ({ start, end });

const winTimes = (windows: CalendarWindow[]) =>
  windows.map((w) => [w.start, w.end]);

it("dateKeyInTimeZone crosses midnight in the local zone, not UTC", () => {
  // 2026-01-15T05:59Z is still Jan 14 in Chicago (23:59 CST)
  assertEquals(dateKeyInTimeZone(jan6amUTC(15, 5), TZ), "2026-01-14");
  // 2026-01-15T06:00Z is exactly local midnight Jan 15
  assertEquals(dateKeyInTimeZone(jan6amUTC(15, 6), TZ), "2026-01-15");
});

it("subtractAbsences with an empty set returns the input untouched", () => {
  const windows = [win(jan6amUTC(15, 14), jan6amUTC(15, 22))];
  const result = subtractAbsences(windows, new Set(), TZ);
  assertStrictEquals(result, windows); // same reference — zero behavior change
});

it("subtractAbsences removes exactly the absent local day", () => {
  // Two local 8h day-shifts (08:00-16:00 CST = 14:00-22:00Z), Jan 15 + Jan 16
  const windows = [
    win(jan6amUTC(15, 14), jan6amUTC(15, 22)),
    win(jan6amUTC(16, 14), jan6amUTC(16, 22))
  ];
  const result = subtractAbsences(windows, new Set(["2026-01-15"]), TZ);
  assertEquals(winTimes(result), [[jan6amUTC(16, 14), jan6amUTC(16, 22)]]);
});

it("subtractAbsences splits a multi-day window at local midnight", () => {
  // A window spanning Jan 15 12:00Z .. Jan 17 12:00Z; Jan 16 absent (local)
  const windows = [win(jan6amUTC(15, 12), jan6amUTC(17, 12))];
  const result = subtractAbsences(windows, new Set(["2026-01-16"]), TZ);
  // Local midnights are at 06:00Z: keep [15@12Z, 16@06Z) and [17@06Z, 17@12Z)
  assertEquals(winTimes(result), [
    [jan6amUTC(15, 12), jan6amUTC(16, 6)],
    [jan6amUTC(17, 6), jan6amUTC(17, 12)]
  ]);
});

it("clipWindowsToDates keeps only the assigned dates", () => {
  const windows = [
    win(jan6amUTC(15, 14), jan6amUTC(15, 22)),
    win(jan6amUTC(16, 14), jan6amUTC(16, 22))
  ];
  const result = clipWindowsToDates(windows, new Set(["2026-01-16"]), TZ);
  assertEquals(winTimes(result), [[jan6amUTC(16, 14), jan6amUTC(16, 22)]]);
  assertEquals(clipWindowsToDates(windows, new Set(), TZ), []);
});

it("buildPeopleByWorkCenter groups by work center and date, deduped", () => {
  const map = buildPeopleByWorkCenter([
    {
      workCenterId: "wc1",
      employeeId: "e1",
      date: "2026-01-15",
      shiftId: null
    },
    {
      workCenterId: "wc1",
      employeeId: "e2",
      date: "2026-01-15",
      shiftId: null
    },
    {
      workCenterId: "wc1",
      employeeId: "e1",
      date: "2026-01-15",
      shiftId: "s1"
    },
    { workCenterId: "wc2", employeeId: "e1", date: "2026-01-16", shiftId: null }
  ]);
  assertEquals(map.get("wc1")?.get("2026-01-15"), ["e1", "e2"]);
  assertEquals(map.get("wc2")?.get("2026-01-16"), ["e1"]);
  assertEquals(map.get("wc2")?.get("2026-01-15"), undefined);
});

it("buildAbsencesByEmployee collects dates per person", () => {
  const map = buildAbsencesByEmployee([
    { employeeId: "e1", date: "2026-01-15", shiftId: null },
    { employeeId: "e1", date: "2026-01-16", shiftId: "s1" },
    { employeeId: "e2", date: "2026-01-15", shiftId: null }
  ]);
  assertEquals(map.get("e1"), new Set(["2026-01-15", "2026-01-16"]));
  assertEquals(map.get("e2"), new Set(["2026-01-15"]));
});

it("buildOvertimeByEmployee takes the day's max, never summing stations", () => {
  const map = buildOvertimeByEmployee([
    // prettier-ignore
    {
      workCenterId: "wc1",
      employeeId: "e1",
      date: "2026-01-15",
      shiftId: null,
      overtimeHours: 2
    },
    // prettier-ignore
    {
      workCenterId: "wc2",
      employeeId: "e1",
      date: "2026-01-15",
      shiftId: null,
      overtimeHours: 1
    },
    // prettier-ignore
    {
      workCenterId: "wc1",
      employeeId: "e1",
      date: "2026-01-16",
      shiftId: null,
      overtimeHours: 0
    },
    { workCenterId: "wc1", employeeId: "e2", date: "2026-01-15", shiftId: null }
  ]);
  // overtime lengthens the DAY — splitting across stations must not multiply it
  assertEquals(map.get("e1")?.get("2026-01-15"), 2);
  assertEquals(map.get("e1")?.get("2026-01-16"), undefined);
  assertEquals(map.get("e2"), undefined);
});

it("buildOvertimeByEmployee counts a day value stamped on every row once", () => {
  // exactly what setPeopleDay / setPeopleOvertimeBulk write: the same day value
  // on each of the day's station rows
  const map = buildOvertimeByEmployee([
    // prettier-ignore
    {
      workCenterId: "wc1",
      employeeId: "e1",
      date: "2026-01-15",
      shiftId: null,
      overtimeHours: 2
    },
    // prettier-ignore
    {
      workCenterId: "wc2",
      employeeId: "e1",
      date: "2026-01-15",
      shiftId: null,
      overtimeHours: 2
    },
    // prettier-ignore
    {
      workCenterId: "wc3",
      employeeId: "e1",
      date: "2026-01-15",
      shiftId: null,
      overtimeHours: 2
    }
  ]);
  assertEquals(map.get("e1")?.get("2026-01-15"), 2);
});

it("extendWindowsByOvertime with no overtime returns the input untouched", () => {
  const windows = [win(jan6amUTC(15, 14), jan6amUTC(15, 22))];
  assertStrictEquals(extendWindowsByOvertime(windows, new Map(), TZ), windows);
});

it("extendWindowsByOvertime lengthens the right day's last window", () => {
  const windows = [
    win(jan6amUTC(15, 14), jan6amUTC(15, 22)), // Jan 15: 8am-4pm local
    win(jan6amUTC(16, 14), jan6amUTC(16, 22)) // Jan 16
  ];
  const result = extendWindowsByOvertime(
    windows,
    new Map([["2026-01-15", 2]]),
    TZ
  );
  assertEquals(winTimes(result), [
    [jan6amUTC(15, 14), jan6amUTC(16, 0)],
    [jan6amUTC(16, 14), jan6amUTC(16, 22)]
  ]);
  // input untouched
  assertEquals(windows[0]?.end, jan6amUTC(15, 22));
});

it("extendWindowsByOvertime merges when the extension reaches the next window", () => {
  const windows = [
    win(jan6amUTC(15, 14), jan6amUTC(15, 22)),
    win(jan6amUTC(15, 23), jan6amUTC(16, 2)) // evening stint same local day
  ];
  // +4h on the LAST Jan-15 window (ends 20:00 local) reaches past midnight
  const result = extendWindowsByOvertime(
    windows,
    new Map([["2026-01-15", 4]]),
    TZ
  );
  assertEquals(winTimes(result), [
    [jan6amUTC(15, 14), jan6amUTC(15, 22)],
    [jan6amUTC(15, 23), jan6amUTC(16, 6)]
  ]);
});

it("extendWindowsByOvertime skips dates with no window", () => {
  const windows = [win(jan6amUTC(15, 14), jan6amUTC(15, 22))];
  const result = extendWindowsByOvertime(
    windows,
    new Map([["2026-01-16", 2]]),
    TZ
  );
  assertEquals(winTimes(result), winTimes(windows));
});

it("buildPeopleBudgets keeps day rows in input order", () => {
  const map = buildPeopleBudgets([
    // prettier-ignore
    {
      workCenterId: "wc1",
      employeeId: "e1",
      date: "2026-01-15",
      shiftId: null,
      hours: 3
    },
    // prettier-ignore
    {
      workCenterId: "wc2",
      employeeId: "e1",
      date: "2026-01-15",
      shiftId: null,
      hours: 5
    },
    { workCenterId: "wc1", employeeId: "e1", date: "2026-01-16", shiftId: null }
  ]);
  assertEquals(map.get("e1")?.get("2026-01-15"), [
    { workCenterId: "wc1", hours: 3 },
    { workCenterId: "wc2", hours: 5 }
  ]);
  assertEquals(map.get("e1")?.get("2026-01-16"), [
    { workCenterId: "wc1", hours: null }
  ]);
});

it("clipWindowsToStation with a sole whole-shift row keeps the full day", () => {
  const windows = [
    win(jan6amUTC(15, 14), jan6amUTC(15, 22)),
    win(jan6amUTC(16, 14), jan6amUTC(16, 22))
  ];
  const budgets = new Map([
    ["2026-01-15", [{ workCenterId: "wc1", hours: null }]]
  ]);
  const result = clipWindowsToStation(
    windows,
    "wc1",
    new Set(["2026-01-15"]),
    budgets,
    TZ
  );
  assertEquals(winTimes(result), [[jan6amUTC(15, 14), jan6amUTC(15, 22)]]);
});

it("clipWindowsToStation deals a split day out sequentially", () => {
  // 8h day: 8am-4pm local (14:00Z-22:00Z)
  const windows = [win(jan6amUTC(15, 14), jan6amUTC(15, 22))];
  const budgets = new Map([
    [
      "2026-01-15",
      [
        { workCenterId: "wc1", hours: 3 },
        { workCenterId: "wc2", hours: 5 }
      ]
    ]
  ]);
  const dates = new Set(["2026-01-15"]);
  // first row: the first 3 attended hours
  assertEquals(
    winTimes(clipWindowsToStation(windows, "wc1", dates, budgets, TZ)),
    [[jan6amUTC(15, 14), jan6amUTC(15, 17)]]
  );
  // second row: the following 5
  assertEquals(
    winTimes(clipWindowsToStation(windows, "wc2", dates, budgets, TZ)),
    [[jan6amUTC(15, 17), jan6amUTC(15, 22)]]
  );
});

it("clipWindowsToStation walks attended time across gaps (split shift)", () => {
  // 8-12 and 13-17 local => 14:00Z-18:00Z and 19:00Z-23:00Z
  const windows = [
    win(jan6amUTC(15, 14), jan6amUTC(15, 18)),
    win(jan6amUTC(15, 19), jan6amUTC(15, 23))
  ];
  const budgets = new Map([
    [
      "2026-01-15",
      [
        { workCenterId: "wc1", hours: 4 },
        { workCenterId: "wc2", hours: 4 }
      ]
    ]
  ]);
  const dates = new Set(["2026-01-15"]);
  assertEquals(
    winTimes(clipWindowsToStation(windows, "wc1", dates, budgets, TZ)),
    [[jan6amUTC(15, 14), jan6amUTC(15, 18)]]
  );
  assertEquals(
    winTimes(clipWindowsToStation(windows, "wc2", dates, budgets, TZ)),
    [[jan6amUTC(15, 19), jan6amUTC(15, 23)]]
  );
});

it("clipWindowsToStation gives nothing after an earlier whole-shift row", () => {
  const windows = [win(jan6amUTC(15, 14), jan6amUTC(15, 22))];
  const budgets = new Map([
    [
      "2026-01-15",
      [
        { workCenterId: "wc1", hours: null },
        { workCenterId: "wc2", hours: 4 }
      ]
    ]
  ]);
  assertEquals(
    clipWindowsToStation(windows, "wc2", new Set(["2026-01-15"]), budgets, TZ),
    []
  );
});

it("clipWindowsToStation without budget rows behaves like clipWindowsToDates", () => {
  const windows = [
    win(jan6amUTC(15, 14), jan6amUTC(15, 22)),
    win(jan6amUTC(16, 14), jan6amUTC(16, 22))
  ];
  const result = clipWindowsToStation(
    windows,
    "wc1",
    new Set(["2026-01-16"]),
    undefined,
    TZ
  );
  assertEquals(
    winTimes(result),
    winTimes(clipWindowsToDates(windows, new Set(["2026-01-16"]), TZ))
  );
});

it("subtractDates with an empty set returns the input untouched", () => {
  const windows = [win(jan6amUTC(15, 14), jan6amUTC(15, 22))];
  const result = subtractDates(windows, new Set(), TZ);
  assertStrictEquals(result, windows); // same reference — byte-identical guarantee
});

it("buildAssignmentsByEmployee inverts the board to employee -> date -> stations", () => {
  // wc1 has A+B on the 15th; wc2 has A on the 15th and 16th
  const peopleByWorkCenter = buildPeopleByWorkCenter([
    { workCenterId: "wc1", employeeId: "A", date: "2026-01-15", shiftId: null },
    { workCenterId: "wc1", employeeId: "B", date: "2026-01-15", shiftId: null },
    { workCenterId: "wc2", employeeId: "A", date: "2026-01-15", shiftId: null },
    { workCenterId: "wc2", employeeId: "A", date: "2026-01-16", shiftId: null }
  ]);
  const assignments = buildAssignmentsByEmployee(peopleByWorkCenter);
  assertEquals([...(assignments.get("A")?.get("2026-01-15") ?? [])].sort(), [
    "wc1",
    "wc2"
  ]);
  assertEquals([...(assignments.get("A")?.get("2026-01-16") ?? [])], ["wc2"]);
  assertEquals([...(assignments.get("B")?.get("2026-01-15") ?? [])], ["wc1"]);
});

it("buildAssignmentsByEmployee marks who is on the board (spoken for)", () => {
  // A person on the board at all is "managed"; one who isn't stays a floater.
  const peopleByWorkCenter = buildPeopleByWorkCenter([
    {
      workCenterId: "wc-dmu",
      employeeId: "brad",
      date: "2026-01-15",
      shiftId: null
    }
  ]);
  const assignments = buildAssignmentsByEmployee(peopleByWorkCenter);
  assertEquals(assignments.has("brad"), true); // manned somewhere => not a floater
  assertEquals(assignments.has("carol"), false); // never on the board => floater
});
