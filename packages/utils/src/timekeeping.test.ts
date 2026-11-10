// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import {
  certificationTextFor,
  dilutionFactor,
  heldProjectRefusal,
  isEntryDateAllowed,
  nextEntryStatus,
  TIMESHEET_REFUSAL_NOT_DRAFT,
  TIMESHEET_REFUSAL_POSTED,
  timecardShortfall,
  timesheetCellReasons,
  timesheetWeek,
  weekStartOf
} from "./timekeeping";

describe("isEntryDateAllowed", () => {
  it("marks a date before the window as late", () => {
    const today = "2026-10-09";
    expect(
      isEntryDateAllowed({
        entryDate: "2026-10-08",
        today,
        windowDays: 1,
        isLeave: false
      })
    ).toEqual({ allowed: true, late: false });
    expect(
      isEntryDateAllowed({
        entryDate: "2026-10-06",
        today,
        windowDays: 1,
        isLeave: false
      })
    ).toEqual({ allowed: true, late: true });
  });

  it("refuses a future date, except on a leave element", () => {
    const today = "2026-10-09";
    expect(
      isEntryDateAllowed({
        entryDate: "2026-10-10",
        today,
        windowDays: 1,
        isLeave: false
      })
    ).toEqual({ allowed: false, reason: "future" });
    expect(
      isEntryDateAllowed({
        entryDate: "2026-10-10",
        today,
        windowDays: 1,
        isLeave: true
      })
    ).toEqual({ allowed: true, late: false });
  });
});

describe("timesheetCellReasons", () => {
  const today = "2026-10-09";
  const base = { today, windowDays: 1, isLeave: false, actorIsOwner: true };

  it("asks for nothing on the owner's new entry inside the window", () => {
    expect(
      timesheetCellReasons({ ...base, entryDate: today, hasEntry: false })
    ).toEqual({ requiresReason: false, requiresLateReason: false });
  });

  it("asks for a reason when the owner changes a saved entry", () => {
    expect(
      timesheetCellReasons({ ...base, entryDate: today, hasEntry: true })
    ).toEqual({ requiresReason: true, requiresLateReason: false });
  });

  it("asks for a late reason before the window", () => {
    expect(
      timesheetCellReasons({
        ...base,
        entryDate: "2026-10-06",
        hasEntry: false
      })
    ).toEqual({ requiresReason: false, requiresLateReason: true });
    expect(
      timesheetCellReasons({ ...base, entryDate: "2026-10-06", hasEntry: true })
    ).toEqual({ requiresReason: true, requiresLateReason: true });
  });

  it("asks another user for a reason on every change", () => {
    expect(
      timesheetCellReasons({
        ...base,
        entryDate: today,
        hasEntry: false,
        actorIsOwner: false
      })
    ).toEqual({ requiresReason: true, requiresLateReason: false });
  });

  it("asks for no late reason on a future date (the server refuses it)", () => {
    expect(
      timesheetCellReasons({
        ...base,
        entryDate: "2026-10-12",
        hasEntry: false
      })
    ).toEqual({ requiresReason: false, requiresLateReason: false });
  });
});

describe("certificationTextFor", () => {
  const settings = {
    certificationTextExempt: "Exempt text",
    certificationTextNonExempt: "Non-exempt text"
  };

  it("gives the text for the FLSA status", () => {
    expect(certificationTextFor("Exempt", settings)).toBe("Exempt text");
    expect(certificationTextFor("Non-Exempt", settings)).toBe(
      "Non-exempt text"
    );
    // No job row or no status: the Non-Exempt text, as the server picks.
    expect(certificationTextFor(null, settings)).toBe("Non-exempt text");
  });

  it("is null when the text is not set", () => {
    expect(
      certificationTextFor("Exempt", {
        ...settings,
        certificationTextExempt: ""
      })
    ).toBeNull();
    expect(certificationTextFor("Exempt", null)).toBeNull();
  });
});

describe("nextEntryStatus", () => {
  it("refuses a change to a Submitted entry in Standard mode", () => {
    expect(
      nextEntryStatus({
        mode: "Standard",
        current: "Submitted",
        actorIsOwner: true
      })
    ).toEqual({ refuse: TIMESHEET_REFUSAL_NOT_DRAFT });
  });

  it("sends a manager's change to a Draft entry to employee review in DCAA mode", () => {
    expect(
      nextEntryStatus({ mode: "DCAA", current: "Draft", actorIsOwner: false })
    ).toBe("Pending Employee Review");
  });

  it("returns the owner's changed Approved entry to Draft in DCAA mode", () => {
    expect(
      nextEntryStatus({ mode: "DCAA", current: "Approved", actorIsOwner: true })
    ).toBe("Draft");
  });

  it("refuses a change to a Posted entry in DCAA mode", () => {
    expect(
      nextEntryStatus({ mode: "DCAA", current: "Posted", actorIsOwner: true })
    ).toEqual({ refuse: TIMESHEET_REFUSAL_POSTED });
  });
});

describe("weekStartOf", () => {
  it("gives the ISO Monday", () => {
    expect(weekStartOf("2026-10-11")).toBe("2026-10-05");
  });
});

describe("dilutionFactor", () => {
  it("spreads 40 standard hours over a 50-hour week", () => {
    expect(dilutionFactor(40, 50)).toBe(0.8);
  });

  it("keeps factor 1 for a week under the standard hours", () => {
    expect(dilutionFactor(40, 32)).toBe(1);
  });
});

describe("timecardShortfall", () => {
  it("gives the timecard hours the entries do not cover", () => {
    expect(timecardShortfall(38, 40)).toBe(2);
  });
});

describe("timesheetWeek", () => {
  const chicago = "America/Chicago";

  it("keeps a Sunday in the week that started the Monday before", () => {
    const week = timesheetWeek(chicago, 0, parseDate("2026-10-11"));
    expect(week.weekStart).toBe("2026-10-05");
    expect(week.weekEnd).toBe("2026-10-11");
    expect(week.today).toBe("2026-10-11");
  });

  it("starts a new week on Monday", () => {
    const week = timesheetWeek(chicago, 0, parseDate("2026-10-12"));
    expect(week.weekStart).toBe("2026-10-12");
    expect(week.weekEnd).toBe("2026-10-18");
  });

  it("moves whole weeks with the offset", () => {
    expect(timesheetWeek(chicago, -1, parseDate("2026-10-11")).weekStart).toBe(
      "2026-09-28"
    );
    expect(timesheetWeek(chicago, 1, parseDate("2026-10-11")).weekStart).toBe(
      "2026-10-12"
    );
  });

  it("lists 7 days, Monday first", () => {
    const week = timesheetWeek(chicago, 0, parseDate("2026-10-11"));
    expect(week.days).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11"
    ]);
  });

  it("bounds the week at midnight in the zone, not UTC", () => {
    const week = timesheetWeek(chicago, 0, parseDate("2026-10-11"));
    // Chicago is UTC-5 in October.
    expect(week.from).toBe("2026-10-05T05:00:00.000Z");
    expect(week.to).toBe("2026-10-12T04:59:59.999Z");
  });

  it("keeps a week whole across the end of daylight saving time", () => {
    // Daylight saving time ends in Chicago on Sunday 2026-11-01.
    const week = timesheetWeek(chicago, 0, parseDate("2026-11-01"));
    expect(week.weekStart).toBe("2026-10-26");
    expect(week.weekEnd).toBe("2026-11-01");
    expect(week.days).toHaveLength(7);
  });

  it("treats a non-finite offset as this week", () => {
    const week = timesheetWeek(chicago, Number.NaN, parseDate("2026-10-11"));
    expect(week.weekStart).toBe("2026-10-05");
  });
});

describe("heldProjectRefusal", () => {
  const project = {
    identifier: "OB2",
    name: "ORBSEC",
    status: "On Hold",
    stopWorkDate: "2026-10-12"
  };

  it("refuses time from the stop-work date", () => {
    expect(heldProjectRefusal(project, "2026-10-12")).toMatch(/stop-work/);
    expect(heldProjectRefusal(project, "2026-10-13")).toMatch(/stop-work/);
  });

  it("takes time dated before the order", () => {
    expect(heldProjectRefusal(project, "2026-10-11")).toBeNull();
  });

  it("refuses any date on a project On Hold with no order", () => {
    expect(
      heldProjectRefusal({ ...project, stopWorkDate: null }, "2020-01-01")
    ).toEqual("OB2 is On Hold: it takes no new time");
  });

  it("takes time on a Released project", () => {
    expect(
      heldProjectRefusal({ ...project, status: "Released" }, "2026-10-13")
    ).toBeNull();
  });
});
