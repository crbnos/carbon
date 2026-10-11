// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseDate } from "@internationalized/date";
import { expect } from "vitest";
import {
  PROJECT_TEST_USER,
  projectPostingFixture
} from "../lib/project-posting-test-fixture";
import { databaseTest } from "../local-database-test-fixture";
import submitTimesheetWeek, {
  certificationTextHash,
  TIMESHEET_REVIEW_PENDING,
  timecardShortfallMessage
} from "./index";

const WEEK_START = "2026-09-07"; // a Monday
const EXEMPT_TEXT = "I certify this week's hours, exempt.";
const NON_EXEMPT_TEXT = "I certify this week's hours, non-exempt.";

/**
 * The fixture with 5 Draft entries of 7.6 h (38 h) in the week, 5 timecards
 * of 8 h (40 h), an Exempt employee job and the two certification texts.
 */
async function weekFixture(settings: {
  timekeepingControls: "Standard" | "DCAA";
  timesheetTimecardCheck?: "Off" | "Warn" | "Block";
}) {
  const f = await projectPostingFixture({ costTreatment: "Expense" });
  const locationId = `${f.prefix}-location`;
  const days = [0, 1, 2, 3, 4].map((offset) =>
    parseDate(WEEK_START).add({ days: offset }).toString()
  );

  await f.db.transaction().execute(async (trx) => {
    await trx
      .updateTable("companySettings")
      .set({
        timekeepingControls: settings.timekeepingControls,
        timesheetTimecardCheck: settings.timesheetTimecardCheck ?? "Warn",
        timeCardEnabled: true,
        certificationTextExempt: EXEMPT_TEXT,
        certificationTextNonExempt: NON_EXEMPT_TEXT
      })
      .where("id", "=", f.companyId)
      .execute();
    await trx
      .insertInto("location")
      .values({
        id: locationId,
        name: "Plant",
        addressLine1: "1 Main St",
        city: "Springfield",
        postalCode: "00000",
        timezone: "America/New_York",
        companyId: f.companyId,
        createdBy: PROJECT_TEST_USER
      })
      .execute();
    await trx
      .insertInto("employeeJob")
      .values({
        id: PROJECT_TEST_USER,
        companyId: f.companyId,
        locationId,
        flsaStatus: "Exempt"
      })
      .execute();
    await trx
      .insertInto("timesheetEntry")
      .values(
        days.map((entryDate) => ({
          companyId: f.companyId,
          employeeId: PROJECT_TEST_USER,
          entryDate,
          projectId: f.projectId,
          projectElementId: f.elementId,
          laborCategoryId: f.laborCategoryId,
          hours: 7.6,
          status: "Draft" as const,
          createdBy: PROJECT_TEST_USER
        }))
      )
      .execute();
    // 9:00 to 17:00 in New York (EDT, UTC−4).
    await trx
      .insertInto("timeCardEntry")
      .values(
        days.map((date) => ({
          companyId: f.companyId,
          employeeId: PROJECT_TEST_USER,
          clockIn: `${date}T13:00:00Z`,
          clockOut: `${date}T21:00:00Z`,
          createdBy: PROJECT_TEST_USER
        }))
      )
      .execute();
  });

  const entries = () =>
    f.db
      .selectFrom("timesheetEntry")
      .select(["id", "status", "submittedAt"])
      .where("companyId", "=", f.companyId)
      .orderBy("entryDate")
      .execute();
  const certifications = () =>
    f.db
      .selectFrom("timesheetCertification")
      .selectAll()
      .where("companyId", "=", f.companyId)
      .execute();
  return { ...f, entries, certifications };
}

databaseTest(
  "Standard mode: Draft entries become Submitted, with no certification",
  async () => {
    const f = await weekFixture({ timekeepingControls: "Standard" });
    try {
      const result = await submitTimesheetWeek(f.ctx, {
        employeeId: PROJECT_TEST_USER,
        weekStart: WEEK_START
      });
      expect(result.error).toBeNull();
      expect(result.data?.entryIds).toHaveLength(5);
      expect(result.data?.warnings).toEqual([]);
      const entries = await f.entries();
      expect(entries.every((entry) => entry.status === "Submitted")).toBe(true);
      expect(entries.every((entry) => entry.submittedAt !== null)).toBe(true);
      expect(await f.certifications()).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "DCAA, check Block: 38 h of entries against 40 h of timecards are refused",
  async () => {
    const f = await weekFixture({
      timekeepingControls: "DCAA",
      timesheetTimecardCheck: "Block"
    });
    try {
      const result = await submitTimesheetWeek(f.ctx, {
        employeeId: PROJECT_TEST_USER,
        weekStart: WEEK_START,
        certificationText: EXEMPT_TEXT
      });
      expect(result.error?.status).toEqual(422);
      expect(result.error?.message).toEqual(timecardShortfallMessage(38, 40));
      expect(
        (await f.entries()).every((entry) => entry.status === "Draft")
      ).toBe(true);
      expect(await f.certifications()).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "DCAA, check Warn: the week submits with one warning",
  async () => {
    const f = await weekFixture({
      timekeepingControls: "DCAA",
      timesheetTimecardCheck: "Warn"
    });
    try {
      const result = await submitTimesheetWeek(f.ctx, {
        employeeId: PROJECT_TEST_USER,
        weekStart: WEEK_START,
        certificationText: EXEMPT_TEXT
      });
      expect(result.error).toBeNull();
      expect(result.data?.entryIds).toHaveLength(5);
      expect(result.data?.warnings).toEqual([
        "Your entries account for 38 h of 40 h on your timecards"
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "DCAA: an exempt employee's certification stores the hash of the exempt text",
  async () => {
    const f = await weekFixture({
      timekeepingControls: "DCAA",
      timesheetTimecardCheck: "Off"
    });
    try {
      const stale = await submitTimesheetWeek(f.ctx, {
        employeeId: PROJECT_TEST_USER,
        weekStart: WEEK_START,
        certificationText: NON_EXEMPT_TEXT
      });
      expect(stale.error?.status).toEqual(422);

      const result = await submitTimesheetWeek(f.ctx, {
        employeeId: PROJECT_TEST_USER,
        weekStart: WEEK_START,
        certificationText: EXEMPT_TEXT
      });
      expect(result.error).toBeNull();
      const certifications = await f.certifications();
      expect(certifications).toHaveLength(1);
      expect(certifications[0]).toMatchObject({
        employeeId: PROJECT_TEST_USER,
        weekStart: WEEK_START,
        textHash: certificationTextHash(EXEMPT_TEXT),
        flsaStatus: "Exempt"
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "DCAA: a week with a Pending Employee Review entry is refused",
  async () => {
    const f = await weekFixture({
      timekeepingControls: "DCAA",
      timesheetTimecardCheck: "Off"
    });
    try {
      const [first] = await f.entries();
      await f.db
        .updateTable("timesheetEntry")
        .set({ status: "Pending Employee Review" })
        .where("id", "=", first!.id)
        .where("companyId", "=", f.companyId)
        .execute();
      const result = await submitTimesheetWeek(f.ctx, {
        employeeId: PROJECT_TEST_USER,
        weekStart: WEEK_START,
        certificationText: EXEMPT_TEXT
      });
      expect(result.error?.message).toEqual(TIMESHEET_REVIEW_PENDING);
    } finally {
      await f.cleanup();
    }
  }
);
