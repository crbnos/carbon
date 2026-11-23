// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  attendedHoursByDay,
  buildPeopleCapacityBuckets,
  getShiftWorkingWindows,
  getWorkCenterWorkingWindows,
  withoutOutages,
  workingHoursByDay
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

const windowsFor = (
  workCenters: { id: string; alwaysOn: boolean }[],
  holidayDates = new Set<string>()
) =>
  getWorkCenterWorkingWindows({
    workCenters,
    workCenterShifts: workCenters.map((wc) => ({
      workCenterId: wc.id,
      shiftId: "day"
    })),
    shifts: [dayShift],
    timeZone: TZ,
    holidayDates,
    rangeStart: at("2026-10-26T05:00:00Z"),
    rangeEnd: at("2026-11-02T06:00:00Z")
  });

const available = (windowsByWorkCenter: ReturnType<typeof windowsFor>) =>
  workingHoursByDay({ windowsByWorkCenter, weekDates: WEEK, timezone: TZ });

describe("available hours", () => {
  it("are 0 on a company holiday, except on a lights-out station", () => {
    const hours = available(
      windowsFor(
        [
          { id: "potting", alwaysOn: false },
          { id: "tvac", alwaysOn: true }
        ],
        new Set(["2026-10-27"])
      )
    );

    expect(hours.get("potting")?.get("2026-10-26")).toBe(8.5);
    expect(hours.get("potting")?.get("2026-10-27")).toBe(0);
    expect(hours.get("tvac")?.get("2026-10-27")).toBe(24);
  });

  // Sunday 1 November 2026 is the day Chicago falls back an hour.
  it("are the length of the local day on a lights-out station", () => {
    const hours = available(windowsFor([{ id: "tvac", alwaysOn: true }]));
    expect(hours.get("tvac")?.get("2026-11-01")).toBe(25);
  });

  it("leave out the time maintenance takes the station offline", () => {
    // Down Friday 11:05 -> Sunday 07:00: Friday keeps 06:00-11:05.
    const windows = withoutOutages(
      windowsFor([{ id: "tig", alwaysOn: false }]),
      new Map([
        [
          "tig",
          [
            {
              start: at("2026-10-30T16:05:00Z"),
              end: at("2026-11-01T12:00:00Z")
            }
          ]
        ]
      ])
    );
    expect(available(windows).get("tig")?.get("2026-10-30")).toBeCloseTo(
      5 + 5 / 60
    );
  });
});

describe("hours due", () => {
  // 1h setup + 0.4h labor and 0.6h machine a piece on 10 pieces, 5 made.
  const operation = {
    workCenterId: "potting",
    dueDate: "2026-10-28",
    operationQuantity: 10,
    quantityComplete: 5,
    setupTime: 1,
    setupUnit: "Total Hours" as const,
    laborTime: 0.4,
    laborUnit: "Hours/Piece" as const,
    machineTime: 0.6,
    machineUnit: "Hours/Piece" as const
  };
  const due = (started: boolean) =>
    buildPeopleCapacityBuckets({
      weekDates: WEEK,
      timezone: TZ,
      operations: [{ ...operation, started }],
      reservations: [],
      calendarHoursByWorkCenter: new Map()
    }).demandByWorkCenter.potting?.days["2026-10-28"];

  // Not started: 1 + max(2, 3) for the 5 pieces left; started: no setup.
  it("are what the scheduler still has to place", () => {
    expect([due(false), due(true)]).toEqual([4, 3]);
  });
});

describe("coverage hours", () => {
  const coverage = (
    reservation: { startAt: string; endAt: string; workHours: number | null },
    operation: { share: number; gated?: boolean },
    options: {
      alwaysOn?: boolean;
      outage?: { start: string; end: string };
    } = {}
  ) =>
    attendedHoursByDay({
      weekDates: WEEK,
      timezone: TZ,
      reservations: [{ resourceId: "tvac", operationId: "op", ...reservation }],
      attendedShareByOperation: new Map([
        ["op", { gated: false, ...operation }]
      ]),
      windowsByWorkCenter: withoutOutages(
        windowsFor([{ id: "tvac", alwaysOn: options.alwaysOn ?? false }]),
        new Map(
          options.outage
            ? [
                [
                  "tvac",
                  [
                    {
                      start: at(options.outage.start),
                      end: at(options.outage.end)
                    }
                  ]
                ]
              ]
            : []
        )
      ),
      lightsOut: new Set(options.alwaysOn ? ["tvac"] : [])
    }).tvac;

  it("spread a long labor run over the shift hours of each day it runs", () => {
    // 20h of labor from Monday 06:00: 8.5h Mon, 8.5h Tue, 3h Wed.
    expect(
      coverage(
        {
          startAt: "2026-10-26T11:00:00Z",
          endAt: "2026-10-28T14:00:00Z",
          workHours: 20
        },
        { share: 1 }
      )
    ).toEqual({ "2026-10-26": 8.5, "2026-10-27": 8.5, "2026-10-28": 3 });
  });

  it("need people only for the hands-on start of a mostly machine run", () => {
    // 4h of a 10h booking is setup and labor: Monday 06:00-10:00.
    expect(
      coverage(
        {
          startAt: "2026-10-26T11:00:00Z",
          endAt: "2026-10-27T13:30:00Z",
          workHours: 10
        },
        { share: 0.4 }
      )
    ).toEqual({ "2026-10-26": 4 });
  });

  it("carry the hands-on hours past a maintenance outage", () => {
    // 10h from Monday 06:00, the station down 08:00-14:30: 2h Mon, 8h Tue.
    expect(
      coverage(
        {
          startAt: "2026-10-26T11:00:00Z",
          endAt: "2026-10-27T19:30:00Z",
          workHours: 10
        },
        { share: 1 },
        {
          outage: { start: "2026-10-26T13:00:00Z", end: "2026-10-26T19:30:00Z" }
        }
      )
    ).toEqual({ "2026-10-26": 2, "2026-10-27": 8 });
  });

  it("need nobody at a lights-out station for work that runs alone", () => {
    const booking = {
      startAt: "2026-10-26T11:00:00Z",
      endAt: "2026-10-29T11:00:00Z",
      workHours: 72
    };
    expect(coverage(booking, { share: 1 }, { alwaysOn: true })).toBeUndefined();
  });

  it("need an operator at a lights-out station when the process needs one", () => {
    // 3h of setup on a 24x7 oven from Monday 06:00.
    expect(
      coverage(
        {
          startAt: "2026-10-26T11:00:00Z",
          endAt: "2026-10-27T11:00:00Z",
          workHours: 24
        },
        { share: 0.125, gated: true },
        { alwaysOn: true }
      )
    ).toEqual({ "2026-10-26": 3 });
  });
});

describe("coverage hours in one shift", () => {
  // The station runs Day 06:00-14:30 and Swing 14:30-23:00.
  const swingShift = {
    ...dayShift,
    id: "swing",
    startTime: "14:30:00",
    endTime: "23:00:00"
  };
  const ladder = {
    shifts: [dayShift, swingShift],
    timeZone: TZ,
    holidayDates: new Set<string>(),
    rangeStart: at("2026-10-26T05:00:00Z"),
    rangeEnd: at("2026-11-02T06:00:00Z")
  };
  const coverageIn = (shiftId?: string) =>
    attendedHoursByDay({
      weekDates: WEEK,
      timezone: TZ,
      // 16h of labor from Monday 06:00: the Day shift, then the Swing shift.
      reservations: [
        {
          resourceId: "weld",
          operationId: "op",
          startAt: "2026-10-26T11:00:00Z",
          endAt: "2026-10-27T04:00:00Z",
          workHours: 16
        }
      ],
      attendedShareByOperation: new Map([["op", { share: 1, gated: false }]]),
      windowsByWorkCenter: getWorkCenterWorkingWindows({
        ...ladder,
        workCenters: [{ id: "weld", alwaysOn: false }],
        workCenterShifts: [
          { workCenterId: "weld", shiftId: "day" },
          { workCenterId: "weld", shiftId: "swing" }
        ]
      }),
      lightsOut: new Set(),
      within: shiftId
        ? (getShiftWorkingWindows({ ...ladder, shiftId }) ?? undefined)
        : undefined
    }).weld;

  it("count the whole day with no shift selected", () => {
    expect(coverageIn()).toEqual({ "2026-10-26": 16 });
  });

  it("count only the hours booked inside the selected shift", () => {
    expect(coverageIn("day")).toEqual({ "2026-10-26": 8.5 });
    expect(coverageIn("swing")).toEqual({ "2026-10-26": 7.5 });
  });

  it("have no windows for a shift the location does not keep", () => {
    expect(getShiftWorkingWindows({ ...ladder, shiftId: "night" })).toBeNull();
  });
});

describe("coverage hours in a night shift", () => {
  // Night runs 22:00-06:00, Monday to Friday nights.
  const nightShift = {
    ...dayShift,
    id: "night",
    startTime: "22:00:00",
    endTime: "06:00:00"
  };
  const ladder = {
    shifts: [nightShift],
    timeZone: TZ,
    holidayDates: new Set<string>(),
    rangeStart: at("2026-10-26T05:00:00Z"),
    rangeEnd: at("2026-11-02T06:00:00Z")
  };

  // The roster puts Friday's night shift on Friday, so its hours past
  // midnight are needed on Friday, not on a Saturday nobody is rostered.
  it("count a shift's hours on the day it starts", () => {
    expect(
      attendedHoursByDay({
        weekDates: WEEK,
        timezone: TZ,
        // Friday 22:00 to Saturday 06:00, plant time
        reservations: [
          {
            resourceId: "weld",
            operationId: "op",
            startAt: "2026-10-31T03:00:00Z",
            endAt: "2026-10-31T11:00:00Z",
            workHours: 8
          }
        ],
        attendedShareByOperation: new Map([["op", { share: 1, gated: false }]]),
        windowsByWorkCenter: getWorkCenterWorkingWindows({
          ...ladder,
          workCenters: [{ id: "weld", alwaysOn: false }],
          workCenterShifts: [{ workCenterId: "weld", shiftId: "night" }]
        }),
        lightsOut: new Set(),
        within: getShiftWorkingWindows({ ...ladder, shiftId: "night" }) ?? []
      }).weld
    ).toEqual({ "2026-10-30": 8 });
  });
});
