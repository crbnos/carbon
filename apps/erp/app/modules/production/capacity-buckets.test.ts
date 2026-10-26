// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildPeopleCapacityBuckets,
  getWorkCenterCalendarHoursByDay,
  getWorkCenterWorkingWindows
} from "./production.service";

// America/Chicago is UTC-5 in late October 2026. Day Shift 06:00-14:30 Mon-Fri.
const TZ = "America/Chicago";
const at = (iso: string) => Date.parse(iso);
const WEEK = [
  "2026-10-26",
  "2026-10-27",
  "2026-10-28",
  "2026-10-29",
  "2026-10-30",
  "2026-10-31",
  "2026-11-01"
];
const dayShift = {
  id: "day",
  startTime: "06:00:00",
  endTime: "14:30:00",
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: false,
  sunday: false
};

const scheduled = (
  reservation: { startAt: string; endAt: string; workHours: number },
  holidayDates = new Set<string>()
) =>
  buildPeopleCapacityBuckets({
    weekDates: WEEK,
    timezone: TZ,
    operations: [],
    reservations: [{ resourceId: "potting", ...reservation }],
    calendarHoursByWorkCenter: new Map(),
    workingWindowsByWorkCenter: getWorkCenterWorkingWindows({
      workCenters: [{ id: "potting", alwaysOn: false }],
      workCenterShifts: [{ workCenterId: "potting", shiftId: "day" }],
      shifts: [dayShift],
      timeZone: TZ,
      holidayDates,
      rangeStart: at("2026-10-20T05:00:00Z"),
      rangeEnd: at("2026-11-10T06:00:00Z")
    })
  }).scheduledByWorkCenter.potting;

describe("buildPeopleCapacityBuckets", () => {
  it("divides an overnight booking over the shift hours of each day", () => {
    // 8h booked Mon 12:00 -> Tue 11:30: Mon 12:00-14:30 + Tue 06:00-11:30.
    expect(
      scheduled({
        startAt: "2026-10-26T17:00:00Z",
        endAt: "2026-10-27T16:30:00Z",
        workHours: 8
      })
    ).toEqual({ "2026-10-26": 2.5, "2026-10-27": 5.5 });
  });

  it("puts no hours on a weekend the station does not work", () => {
    // 24h booked Thu 07:30 -> Mon 14:30: Thu 7h + Fri 8.5h + Mon 8.5h.
    expect(
      scheduled({
        startAt: "2026-10-29T12:30:00Z",
        endAt: "2026-11-02T20:30:00Z",
        workHours: 24
      })
    ).toEqual({ "2026-10-29": 7, "2026-10-30": 8.5 });
  });

  it("puts no hours on a company holiday", () => {
    // 17h booked Mon 06:00 -> Wed 14:30 with Tuesday a holiday: Mon + Wed.
    expect(
      scheduled(
        {
          startAt: "2026-10-26T11:00:00Z",
          endAt: "2026-10-28T19:30:00Z",
          workHours: 17
        },
        new Set(["2026-10-27"])
      )
    ).toEqual({ "2026-10-26": 8.5, "2026-10-28": 8.5 });
  });
});

describe("available hours", () => {
  it("are 0 on a company holiday, except on a lights-out station", () => {
    const hours = getWorkCenterCalendarHoursByDay({
      workCenters: [
        { id: "potting", alwaysOn: false },
        { id: "tvac", alwaysOn: true }
      ],
      workCenterShifts: [{ workCenterId: "potting", shiftId: "day" }],
      locationShifts: [
        {
          id: "day",
          hours: 8.5,
          runsOn: [false, true, true, true, true, true, false]
        }
      ],
      weekDates: WEEK,
      holidayDates: new Set(["2026-10-27"])
    });

    expect(hours.get("potting")?.get("2026-10-26")).toBe(8.5);
    expect(hours.get("potting")?.get("2026-10-27")).toBe(0);
    expect(hours.get("tvac")?.get("2026-10-27")).toBe(24);
  });
});

describe("a station linked to a shift of another location", () => {
  const windows = (args: {
    shifts: (typeof dayShift)[];
    linkedShifts?: (typeof dayShift)[];
  }) =>
    getWorkCenterWorkingWindows({
      workCenters: [{ id: "potting", alwaysOn: false }],
      workCenterShifts: [{ workCenterId: "potting", shiftId: "day" }],
      timeZone: TZ,
      holidayDates: new Set(),
      rangeStart: at("2026-10-26T05:00:00Z"),
      rangeEnd: at("2026-10-27T05:00:00Z"),
      ...args
    }).get("potting");

  it("works that shift's hours, not the location's", () => {
    // Monday 06:00-14:30 Chicago, from the linked shift alone.
    expect(windows({ shifts: [], linkedShifts: [dayShift] })).toEqual([
      { start: at("2026-10-26T11:00:00Z"), end: at("2026-10-26T19:30:00Z") }
    ]);
  });

  it("has that shift's hours available", () => {
    const hours = getWorkCenterCalendarHoursByDay({
      workCenters: [{ id: "potting", alwaysOn: false }],
      workCenterShifts: [{ workCenterId: "potting", shiftId: "day" }],
      locationShifts: [],
      linkedShifts: [
        {
          id: "day",
          hours: 8.5,
          runsOn: [false, true, true, true, true, true, false]
        }
      ],
      weekDates: WEEK
    });

    expect(hours.get("potting")?.get("2026-10-26")).toBe(8.5);
  });
});
