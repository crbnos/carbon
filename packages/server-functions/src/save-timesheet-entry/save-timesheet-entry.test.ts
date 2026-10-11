// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { datetime } from "@carbon/utils";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  PROJECT_TEST_USER,
  projectPostingFixture
} from "../lib/project-posting-test-fixture";
import { databaseTest } from "../local-database-test-fixture";
import { ServerFnContext } from "../server-fn-context";
import saveTimesheetEntry, {
  TIMESHEET_CHANGE_REASON_REQUIRED,
  TIMESHEET_FUTURE_DATE,
  TIMESHEET_LATE_REASON_REQUIRED,
  TIMESHEET_SUPERVISOR_ENTRY_REFUSED
} from "./index";

const TIMEZONE = "America/New_York";
const today = datetime.today(TIMEZONE);
const day = (offset: number) => today.add({ days: offset }).toString();

/** The fixture, a manager (a second user) and DCAA mode when asked. */
async function timesheetFixture(mode: "Standard" | "DCAA") {
  const f = await projectPostingFixture({ costTreatment: "Expense" });
  const managerId = `${f.prefix}-manager`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    await trx
      .insertInto("user")
      .values({ id: managerId, email: `${managerId}@example.com` })
      .execute();
  });
  await f.db
    .updateTable("companySettings")
    .set({ timekeepingControls: mode, timesheetEntryWindowDays: 1 })
    .where("id", "=", f.companyId)
    .execute();

  const cell = {
    employeeId: PROJECT_TEST_USER,
    projectId: f.projectId,
    projectElementId: f.elementId,
    laborCategoryId: f.laborCategoryId
  };
  const manager = ServerFnContext.system({
    db: f.db,
    companyId: f.companyId,
    userId: managerId
  });
  const revisions = () =>
    f.db
      .selectFrom("timesheetEntryRevision")
      .selectAll()
      .where("companyId", "=", f.companyId)
      .orderBy("revisedAt")
      .orderBy("id")
      .execute();
  const entry = (id: string) =>
    f.db
      .selectFrom("timesheetEntry")
      .selectAll()
      .where("id", "=", id)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();

  return {
    ...f,
    cell,
    manager,
    managerId,
    revisions,
    entry,
    async cleanup() {
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx.deleteFrom("user").where("id", "=", managerId).execute();
      });
      await f.cleanup();
    }
  };
}

databaseTest("Standard mode: a Draft cell saves with no revision", async () => {
  const f = await timesheetFixture("Standard");
  try {
    const saved = await saveTimesheetEntry(f.ctx, {
      ...f.cell,
      entryDate: day(-5),
      hours: 6
    });
    expect(saved.error).toBeNull();
    expect(saved.data?.status).toEqual("Draft");

    const changed = await saveTimesheetEntry(f.ctx, {
      ...f.cell,
      entryDate: day(-5),
      hours: 4
    });
    expect(changed.data?.entryId).toEqual(saved.data?.entryId);
    expect(Number((await f.entry(saved.data!.entryId!)).hours)).toEqual(4);
    expect(await f.revisions()).toHaveLength(0);

    // A submitted entry is refused with the Phase 1a message.
    await f.db
      .updateTable("timesheetEntry")
      .set({ status: "Submitted" })
      .where("id", "=", saved.data!.entryId!)
      .where("companyId", "=", f.companyId)
      .execute();
    const refused = await saveTimesheetEntry(f.ctx, {
      ...f.cell,
      entryDate: day(-5),
      hours: 2
    });
    expect(refused.error?.message).toEqual(
      "This time is submitted. It can change only after it is rejected."
    );
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "DCAA, window 1: a late entry needs a late reason, which it stores",
  async () => {
    const f = await timesheetFixture("DCAA");
    try {
      const refused = await saveTimesheetEntry(f.ctx, {
        ...f.cell,
        entryDate: day(-3),
        hours: 8
      });
      expect(refused.error?.status).toEqual(422);
      expect(refused.error?.message).toEqual(TIMESHEET_LATE_REASON_REQUIRED);

      const saved = await saveTimesheetEntry(f.ctx, {
        ...f.cell,
        entryDate: day(-3),
        hours: 8,
        lateReason: "Travelling without a laptop"
      });
      expect(saved.error).toBeNull();
      const row = await f.entry(saved.data!.entryId!);
      expect(row.lateReason).toEqual("Travelling without a laptop");
      expect(row.status).toEqual("Draft");
      // The owner's first save is not a change.
      expect(await f.revisions()).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("DCAA: an entry for tomorrow is refused", async () => {
  const f = await timesheetFixture("DCAA");
  try {
    const refused = await saveTimesheetEntry(f.ctx, {
      ...f.cell,
      entryDate: day(1),
      hours: 8
    });
    expect(refused.error?.message).toEqual(TIMESHEET_FUTURE_DATE);
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "DCAA: the owner's change writes one revision with before, after, actor and reason",
  async () => {
    const f = await timesheetFixture("DCAA");
    try {
      const saved = await saveTimesheetEntry(f.ctx, {
        ...f.cell,
        entryDate: day(0),
        hours: 6
      });
      expect(saved.error).toBeNull();

      const noReason = await saveTimesheetEntry(f.ctx, {
        ...f.cell,
        entryDate: day(0),
        hours: 4
      });
      expect(noReason.error?.message).toEqual(TIMESHEET_CHANGE_REASON_REQUIRED);

      const changed = await saveTimesheetEntry(f.ctx, {
        ...f.cell,
        entryDate: day(0),
        hours: 4,
        reason: "Left early"
      });
      expect(changed.error).toBeNull();

      const revisions = await f.revisions();
      expect(revisions).toHaveLength(1);
      expect(revisions[0]).toMatchObject({
        timesheetEntryId: saved.data?.entryId,
        employeeId: PROJECT_TEST_USER,
        revisedBy: PROJECT_TEST_USER,
        reason: "Left early"
      });
      expect((revisions[0]!.before as { hours: number }).hours).toEqual(6);
      expect((revisions[0]!.after as { hours: number }).hours).toEqual(4);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "DCAA: a manager's change gives Pending Employee Review",
  async () => {
    const f = await timesheetFixture("DCAA");
    try {
      const saved = await saveTimesheetEntry(f.ctx, {
        ...f.cell,
        entryDate: day(0),
        hours: 8
      });
      const changed = await saveTimesheetEntry(f.manager, {
        ...f.cell,
        entryDate: day(0),
        hours: 7,
        reason: "Timecard shows 7 h"
      });
      expect(changed.error).toBeNull();
      expect(changed.data?.status).toEqual("Pending Employee Review");
      expect((await f.entry(saved.data!.entryId!)).status).toEqual(
        "Pending Employee Review"
      );
      const revisions = await f.revisions();
      expect(revisions).toHaveLength(1);
      expect(revisions[0]!.revisedBy).toEqual(f.managerId);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "DCAA: a manager creates an entry only on a day of recorded absence",
  async () => {
    const f = await timesheetFixture("DCAA");
    try {
      const refused = await saveTimesheetEntry(f.manager, {
        ...f.cell,
        entryDate: day(0),
        hours: 8,
        reason: "Out sick, entered for the employee"
      });
      expect(refused.error?.message).toEqual(
        TIMESHEET_SUPERVISOR_ENTRY_REFUSED
      );

      await f.db
        .insertInto("peopleAbsence")
        .values({
          companyId: f.companyId,
          employeeId: PROJECT_TEST_USER,
          date: day(0),
          createdBy: f.managerId
        })
        .execute();
      const saved = await saveTimesheetEntry(f.manager, {
        ...f.cell,
        entryDate: day(0),
        hours: 8,
        reason: "Out sick, entered for the employee"
      });
      expect(saved.error).toBeNull();
      expect(saved.data?.status).toEqual("Pending Employee Review");
      const revisions = await f.revisions();
      expect(revisions).toHaveLength(1);
      expect(revisions[0]!.before).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);
