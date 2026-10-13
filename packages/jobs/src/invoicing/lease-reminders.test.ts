// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  dueLeaseReminders,
  type LeaseReminderCandidate
} from "./lease-reminders";

const lease = (
  overrides: Partial<LeaseReminderCandidate>
): LeaseReminderCandidate => ({
  id: "lease-1",
  noticeDate: null,
  endDate: "2029-12-31",
  noticeRemindedFor: null,
  endRemindedFor: null,
  ...overrides
});

describe("dueLeaseReminders", () => {
  it("reminds an open-ended lease of its notice date only", () => {
    expect(
      dueLeaseReminders(
        [lease({ endDate: null, noticeDate: "2027-02-01" })],
        "2027-01-01",
        90
      )
    ).toEqual([{ leaseId: "lease-1", kind: "notice", date: "2027-02-01" }]);
  });

  it("reminds a date exactly the lead days away, and not one day further", () => {
    expect(
      dueLeaseReminders(
        [
          lease({ id: "in", endDate: "2027-03-31" }),
          lease({ id: "out", endDate: "2027-04-01" })
        ],
        "2027-01-01",
        89
      )
    ).toEqual([{ leaseId: "in", kind: "end", date: "2027-03-31" }]);
  });

  it("reminds the notice date and the end date separately", () => {
    expect(
      dueLeaseReminders(
        [lease({ noticeDate: "2027-01-15", endDate: "2027-02-28" })],
        "2027-01-01",
        90
      )
    ).toEqual([
      { leaseId: "lease-1", kind: "notice", date: "2027-01-15" },
      { leaseId: "lease-1", kind: "end", date: "2027-02-28" }
    ]);
  });

  it("does not remind a date it already reminded for", () => {
    expect(
      dueLeaseReminders(
        [
          lease({
            noticeDate: "2027-01-15",
            noticeRemindedFor: "2027-01-15",
            endDate: "2027-02-28",
            endRemindedFor: "2027-02-28"
          })
        ],
        "2027-01-01",
        90
      )
    ).toEqual([]);
  });

  it("reminds again when the date moved after the reminder", () => {
    expect(
      dueLeaseReminders(
        [lease({ endDate: "2027-03-31", endRemindedFor: "2027-02-28" })],
        "2027-01-01",
        90
      )
    ).toEqual([{ leaseId: "lease-1", kind: "end", date: "2027-03-31" }]);
  });

  it("never reminds a date that has passed", () => {
    expect(
      dueLeaseReminders(
        [lease({ noticeDate: "2026-12-31", endDate: "2026-12-31" })],
        "2027-01-01",
        90
      )
    ).toEqual([]);
  });

  it("crosses a month end and a leap day", () => {
    expect(
      dueLeaseReminders([lease({ endDate: "2028-03-01" })], "2028-02-28", 2)
    ).toEqual([{ leaseId: "lease-1", kind: "end", date: "2028-03-01" }]);
    expect(
      dueLeaseReminders([lease({ endDate: "2028-03-01" })], "2028-02-28", 1)
    ).toEqual([]);
  });
});
