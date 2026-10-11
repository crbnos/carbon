// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  dilutionFactor,
  isEntryDateAllowed,
  nextEntryStatus,
  TIMESHEET_REFUSAL_NOT_DRAFT,
  TIMESHEET_REFUSAL_POSTED,
  timecardShortfall,
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
