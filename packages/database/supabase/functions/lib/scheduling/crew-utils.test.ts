import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import type { CalendarWindow } from "./calendar-utils.ts";
import {
  buildAbsencesByEmployee,
  buildCrewByWorkCenter,
  clipWindowsToDates,
  dateKeyInTimeZone,
  subtractAbsences,
} from "./crew-utils.ts";

const TZ = "America/Chicago"; // UTC-6 (CST) / UTC-5 (CDT)

// January (CST, UTC-6): local midnight = 06:00Z
const jan6amUTC = (day: number, hour = 0) =>
  new Date(Date.UTC(2026, 0, day, hour));

const win = (start: Date, end: Date): CalendarWindow => ({ start, end });

const winTimes = (windows: CalendarWindow[]) =>
  windows.map((w) => [w.start.toISOString(), w.end.toISOString()]);

Deno.test("dateKeyInTimeZone crosses midnight in the local zone, not UTC", () => {
  // 2026-01-15T05:59Z is still Jan 14 in Chicago (23:59 CST)
  assertEquals(dateKeyInTimeZone(jan6amUTC(15, 5), TZ), "2026-01-14");
  // 2026-01-15T06:00Z is exactly local midnight Jan 15
  assertEquals(dateKeyInTimeZone(jan6amUTC(15, 6), TZ), "2026-01-15");
});

Deno.test("subtractAbsences with an empty set returns the input untouched", () => {
  const windows = [win(jan6amUTC(15, 14), jan6amUTC(15, 22))];
  const result = subtractAbsences(windows, new Set(), TZ);
  assertStrictEquals(result, windows); // same reference — zero behavior change
});

Deno.test("subtractAbsences removes exactly the absent local day", () => {
  // Two local 8h day-shifts (08:00-16:00 CST = 14:00-22:00Z), Jan 15 + Jan 16
  const windows = [
    win(jan6amUTC(15, 14), jan6amUTC(15, 22)),
    win(jan6amUTC(16, 14), jan6amUTC(16, 22)),
  ];
  const result = subtractAbsences(windows, new Set(["2026-01-15"]), TZ);
  assertEquals(winTimes(result), [
    [jan6amUTC(16, 14).toISOString(), jan6amUTC(16, 22).toISOString()],
  ]);
});

Deno.test("subtractAbsences splits a multi-day window at local midnight", () => {
  // A window spanning Jan 15 12:00Z .. Jan 17 12:00Z; Jan 16 absent (local)
  const windows = [win(jan6amUTC(15, 12), jan6amUTC(17, 12))];
  const result = subtractAbsences(windows, new Set(["2026-01-16"]), TZ);
  // Local midnights are at 06:00Z: keep [15@12Z, 16@06Z) and [17@06Z, 17@12Z)
  assertEquals(winTimes(result), [
    [jan6amUTC(15, 12).toISOString(), jan6amUTC(16, 6).toISOString()],
    [jan6amUTC(17, 6).toISOString(), jan6amUTC(17, 12).toISOString()],
  ]);
});

Deno.test("clipWindowsToDates keeps only the crewed dates", () => {
  const windows = [
    win(jan6amUTC(15, 14), jan6amUTC(15, 22)),
    win(jan6amUTC(16, 14), jan6amUTC(16, 22)),
  ];
  const result = clipWindowsToDates(windows, new Set(["2026-01-16"]), TZ);
  assertEquals(winTimes(result), [
    [jan6amUTC(16, 14).toISOString(), jan6amUTC(16, 22).toISOString()],
  ]);
  assertEquals(clipWindowsToDates(windows, new Set(), TZ), []);
});

Deno.test("buildCrewByWorkCenter groups by work center and date, deduped", () => {
  const map = buildCrewByWorkCenter([
    { workCenterId: "wc1", employeeId: "e1", date: "2026-01-15", shiftId: null },
    { workCenterId: "wc1", employeeId: "e2", date: "2026-01-15", shiftId: null },
    { workCenterId: "wc1", employeeId: "e1", date: "2026-01-15", shiftId: "s1" },
    { workCenterId: "wc2", employeeId: "e1", date: "2026-01-16", shiftId: null },
  ]);
  assertEquals(map.get("wc1")?.get("2026-01-15"), ["e1", "e2"]);
  assertEquals(map.get("wc2")?.get("2026-01-16"), ["e1"]);
  assertEquals(map.get("wc2")?.get("2026-01-15"), undefined);
});

Deno.test("buildAbsencesByEmployee collects dates per person", () => {
  const map = buildAbsencesByEmployee([
    { employeeId: "e1", date: "2026-01-15", shiftId: null },
    { employeeId: "e1", date: "2026-01-16", shiftId: "s1" },
    { employeeId: "e2", date: "2026-01-15", shiftId: null },
  ]);
  assertEquals(map.get("e1"), new Set(["2026-01-15", "2026-01-16"]));
  assertEquals(map.get("e2"), new Set(["2026-01-15"]));
});
