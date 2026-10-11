// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { datetime, TIMESHEET_REFUSAL_NOT_DRAFT } from "@carbon/utils";
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
  TIMESHEET_HOURS_REQUIRED,
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

databaseTest(
  "Standard mode, add: each call adds a new entry with the requested status",
  async () => {
    const f = await timesheetFixture("Standard");
    try {
      const draft = await saveTimesheetEntry(f.ctx, {
        ...f.cell,
        entryDate: day(-2),
        hours: 6
      });
      expect(draft.error).toBeNull();

      // Log time beside a Draft entry: a second entry, the Draft keeps 6 h.
      const logged = await saveTimesheetEntry(f.ctx, {
        ...f.cell,
        entryDate: day(-2),
        hours: 2,
        note: "Fixture rework",
        mode: "add",
        status: "Submitted"
      });
      expect(logged.error).toBeNull();
      expect(logged.data?.status).toEqual("Submitted");
      expect(logged.data?.entryId).not.toEqual(draft.data?.entryId);
      const loggedRow = await f.entry(logged.data!.entryId!);
      expect(loggedRow.status).toEqual("Submitted");
      expect(loggedRow.submittedAt).not.toBeNull();
      expect(loggedRow.note).toEqual("Fixture rework");
      expect(Number((await f.entry(draft.data!.entryId!)).hours)).toEqual(6);

      // A Posted entry in the cell does not stop a second log (service time).
      await f.db
        .updateTable("timesheetEntry")
        .set({ status: "Posted" })
        .where("id", "=", logged.data!.entryId!)
        .where("companyId", "=", f.companyId)
        .execute();
      const again = await saveTimesheetEntry(f.ctx, {
        ...f.cell,
        entryDate: day(-2),
        hours: 1,
        mode: "add",
        status: "Draft",
        serviceVisitId: null
      });
      expect(again.error).toBeNull();
      expect(again.data?.status).toEqual("Draft");
      expect((await f.entry(again.data!.entryId!)).submittedAt).toBeNull();

      // Standard mode has no date window and no revision trail.
      const future = await saveTimesheetEntry(f.ctx, {
        ...f.cell,
        entryDate: day(3),
        hours: 1,
        mode: "add",
        status: "Submitted"
      });
      expect(future.error).toBeNull();
      expect(await f.revisions()).toHaveLength(0);

      // Zero hours adds nothing.
      const empty = await saveTimesheetEntry(f.ctx, {
        ...f.cell,
        entryDate: day(-2),
        hours: 0,
        mode: "add"
      });
      expect(empty.error?.message).toEqual(TIMESHEET_HOURS_REQUIRED);

      // Another user cannot log the employee's time in Standard mode.
      const other = await saveTimesheetEntry(f.manager, {
        ...f.cell,
        entryDate: day(-2),
        hours: 1,
        mode: "add"
      });
      expect(other.error?.message).toEqual(TIMESHEET_REFUSAL_NOT_DRAFT);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "DCAA, add: the cell's controls apply to a new entry",
  async () => {
    const f = await timesheetFixture("DCAA");
    try {
      const add = {
        ...f.cell,
        mode: "add" as const,
        status: "Submitted" as const
      };

      const future = await saveTimesheetEntry(f.ctx, {
        ...add,
        entryDate: day(1),
        hours: 2
      });
      expect(future.error?.message).toEqual(TIMESHEET_FUTURE_DATE);

      const late = await saveTimesheetEntry(f.ctx, {
        ...add,
        entryDate: day(-3),
        hours: 2
      });
      expect(late.error?.message).toEqual(TIMESHEET_LATE_REASON_REQUIRED);

      const first = await saveTimesheetEntry(f.ctx, {
        ...add,
        entryDate: day(-3),
        hours: 2,
        lateReason: "On site with no network"
      });
      expect(first.error).toBeNull();
      // DCAA mode saves the owner's entry as Draft (see the next test).
      expect(first.data?.status).toEqual("Draft");
      expect((await f.entry(first.data!.entryId!)).lateReason).toEqual(
        "On site with no network"
      );

      // A second log on the same cell adds another entry.
      const second = await saveTimesheetEntry(f.ctx, {
        ...add,
        entryDate: day(0),
        hours: 3
      });
      const third = await saveTimesheetEntry(f.ctx, {
        ...add,
        entryDate: day(0),
        hours: 1
      });
      expect(third.error).toBeNull();
      expect(third.data?.entryId).not.toEqual(second.data?.entryId);
      // The owner's own entries are not changes.
      expect(await f.revisions()).toHaveLength(0);

      // Another user adds time only on a recorded absence, with a reason.
      const refused = await saveTimesheetEntry(f.manager, {
        ...add,
        entryDate: day(0),
        hours: 8,
        reason: "Entered for the employee"
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
      const supervisor = await saveTimesheetEntry(f.manager, {
        ...add,
        entryDate: day(0),
        hours: 8,
        reason: "Entered for the employee"
      });
      expect(supervisor.error).toBeNull();
      expect(supervisor.data?.status).toEqual("Pending Employee Review");
      const revisions = await f.revisions();
      expect(revisions).toHaveLength(1);
      expect(revisions[0]).toMatchObject({
        timesheetEntryId: supervisor.data?.entryId,
        revisedBy: f.managerId,
        before: null
      });

      // Charge restrictions: a non-member's time is refused.
      await f.db
        .updateTable("project")
        .set({ restrictCharging: true })
        .where("id", "=", f.projectId)
        .where("companyId", "=", f.companyId)
        .execute();
      const restricted = await saveTimesheetEntry(f.ctx, {
        ...add,
        entryDate: day(0),
        hours: 1
      });
      expect(restricted.error?.message).toMatch(
        /accepts time only from its members$/
      );
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "A cell save without a note keeps the stored note, in both modes",
  async () => {
    for (const mode of ["Standard", "DCAA"] as const) {
      const f = await timesheetFixture(mode);
      try {
        const saved = await saveTimesheetEntry(f.ctx, {
          ...f.cell,
          entryDate: day(0),
          hours: 6,
          note: "Thermal vacuum prep"
        });
        expect(saved.error).toBeNull();

        // The grid sends hours only.
        const changed = await saveTimesheetEntry(f.ctx, {
          ...f.cell,
          entryDate: day(0),
          hours: 4,
          reason: mode === "DCAA" ? "Left early" : undefined
        });
        expect(changed.error).toBeNull();
        const row = await f.entry(saved.data!.entryId!);
        expect(Number(row.hours)).toEqual(4);
        expect(row.note).toEqual("Thermal vacuum prep");

        // A note that is sent replaces the stored one.
        await saveTimesheetEntry(f.ctx, {
          ...f.cell,
          entryDate: day(0),
          hours: 5,
          note: "Bake-out",
          reason: mode === "DCAA" ? "Stayed late" : undefined
        });
        expect((await f.entry(saved.data!.entryId!)).note).toEqual("Bake-out");
      } finally {
        await f.cleanup();
      }
    }
  }
);

databaseTest(
  "DCAA, add: Log time saves the owner's entry as Draft for the weekly certification",
  async () => {
    const f = await timesheetFixture("DCAA");
    try {
      // Log time asks for Submitted, as it does in Standard mode.
      const logged = await saveTimesheetEntry(f.ctx, {
        ...f.cell,
        mode: "add",
        status: "Submitted",
        entryDate: day(0),
        hours: 2
      });
      expect(logged.error).toBeNull();
      expect(logged.data?.status).toEqual("Draft");
      const entry = await f.entry(logged.data!.entryId!);
      expect(entry.status).toEqual("Draft");
      expect(entry.submittedAt).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);
