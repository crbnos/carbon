// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// The People board splits one person's shift across stations, so the board
// keeps one row per person, day, shift and station.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  movePeopleAssignmentCell,
  movePeopleWeek,
  setPeopleDay,
  upsertPeopleAssignment
} from "../../app/modules/production/production.service";
import { alwaysPostFixture, type Fixture, USER } from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";

const DAY = "2026-03-02";
const NEXT_DAY = "2026-03-03";

async function peopleFixture() {
  const f = await alwaysPostFixture();
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    const employeeTypeId = `${f.prefix}-employee-type`;
    await trx
      .insertInto("employeeType")
      .values({ id: employeeTypeId, name: "Employee", companyId: f.companyId })
      .execute();
    await trx
      .insertInto("employee")
      .values({
        id: USER,
        companyId: f.companyId,
        employeeTypeId,
        active: true
      })
      .execute();
  });
  const [first, second] = await f.db
    .insertInto("workCenter")
    .values(
      ["Lathe", "Mill"].map((name) => ({
        name: `${f.prefix} ${name}`,
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      }))
    )
    .returning("id")
    .execute();
  return { f, lathe: first.id, mill: second.id };
}

async function dayRows(f: Fixture, date: string) {
  const rows = await f.db
    .selectFrom("peopleAssignment")
    .select(["workCenterId", "hours"])
    .where("companyId", "=", f.companyId)
    .where("employeeId", "=", USER)
    .where("date", "=", date)
    .execute();
  return rows
    .map((row) => ({
      workCenterId: row.workCenterId,
      hours: row.hours === null ? null : Number(row.hours)
    }))
    .sort((a, b) => a.workCenterId.localeCompare(b.workCenterId));
}

function byStation(rows: { workCenterId: string; hours: number | null }[]) {
  return [...rows].sort((a, b) => a.workCenterId.localeCompare(b.workCenterId));
}

databaseTest("the day editor saves one shift split across two stations", async () => {
  const { f, lathe, mill } = await peopleFixture();
  try {
    const rows = [
      { workCenterId: lathe, hours: 4 },
      { workCenterId: mill, hours: 4 }
    ];
    await setPeopleDay(f.db, USER, {
      companyId: f.companyId,
      locationId: f.locationId,
      employeeId: USER,
      date: DAY,
      shiftId: null,
      note: null,
      overtimeHours: 0,
      rows
    });
    expect(await dayRows(f, DAY)).toEqual(byStation(rows));
  } finally {
    await f.cleanup();
  }
});

databaseTest("a free-hours remainder dragged to a second station is saved", async () => {
  const { f, lathe, mill } = await peopleFixture();
  try {
    await f.db
      .insertInto("peopleAssignment")
      .values({
        companyId: f.companyId,
        locationId: f.locationId,
        workCenterId: lathe,
        employeeId: USER,
        date: DAY,
        shiftId: null,
        hours: 5,
        createdBy: USER
      })
      .execute();

    await upsertPeopleAssignment(f.db, {
      companyId: f.companyId,
      locationId: f.locationId,
      workCenterId: mill,
      employeeId: USER,
      date: DAY,
      shiftId: null,
      hours: 3,
      createdBy: USER
    });

    expect(await dayRows(f, DAY)).toEqual(
      byStation([
        { workCenterId: lathe, hours: 5 },
        { workCenterId: mill, hours: 3 }
      ])
    );
  } finally {
    await f.cleanup();
  }
});

databaseTest("a matrix move onto a day at another station splits that day", async () => {
  const { f, lathe, mill } = await peopleFixture();
  try {
    const [moving] = await f.db
      .insertInto("peopleAssignment")
      .values([
        {
          companyId: f.companyId,
          locationId: f.locationId,
          workCenterId: lathe,
          employeeId: USER,
          date: DAY,
          shiftId: null,
          hours: 3,
          createdBy: USER
        },
        {
          companyId: f.companyId,
          locationId: f.locationId,
          workCenterId: mill,
          employeeId: USER,
          date: NEXT_DAY,
          shiftId: null,
          hours: 5,
          createdBy: USER
        }
      ])
      .returning("id")
      .execute();

    const moved = await movePeopleAssignmentCell(f.db, {
      id: moving.id,
      companyId: f.companyId,
      employeeId: USER,
      date: NEXT_DAY
    });

    expect(moved).toEqual({ id: moving.id, workCenterId: lathe, merged: false });
    expect(await dayRows(f, DAY)).toEqual([]);
    expect(await dayRows(f, NEXT_DAY)).toEqual(
      byStation([
        { workCenterId: lathe, hours: 3 },
        { workCenterId: mill, hours: 5 }
      ])
    );
  } finally {
    await f.cleanup();
  }
});

databaseTest("a week move onto a station the person also works that day adds the hours", async () => {
  const { f, lathe, mill } = await peopleFixture();
  try {
    await f.db
      .insertInto("peopleAssignment")
      .values(
        [lathe, mill].map((workCenterId) => ({
          companyId: f.companyId,
          locationId: f.locationId,
          workCenterId,
          employeeId: USER,
          date: DAY,
          shiftId: null,
          hours: 4,
          createdBy: USER
        }))
      )
      .execute();

    const result = await movePeopleWeek(f.db, {
      companyId: f.companyId,
      employeeId: USER,
      fromWorkCenterId: lathe,
      workCenterId: mill,
      weekStart: DAY,
      shiftId: null
    });

    expect(result).toEqual({ moved: 0, merged: 1 });
    expect(await dayRows(f, DAY)).toEqual([{ workCenterId: mill, hours: 8 }]);
  } finally {
    await f.cleanup();
  }
});

databaseTest("a week move keeps the overtime of the row it merges away", async () => {
  const { f, lathe, mill } = await peopleFixture();
  try {
    // overtime set for one department only stamps that department's station
    await f.db
      .insertInto("peopleAssignment")
      .values(
        [
          { workCenterId: lathe, overtimeHours: 2 },
          { workCenterId: mill, overtimeHours: 0 }
        ].map((row) => ({
          ...row,
          companyId: f.companyId,
          locationId: f.locationId,
          employeeId: USER,
          date: DAY,
          shiftId: null,
          hours: 4,
          createdBy: USER
        }))
      )
      .execute();

    await movePeopleWeek(f.db, {
      companyId: f.companyId,
      employeeId: USER,
      fromWorkCenterId: lathe,
      workCenterId: mill,
      weekStart: DAY,
      shiftId: null
    });

    const rows = await f.db
      .selectFrom("peopleAssignment")
      .select(["workCenterId", "hours", "overtimeHours"])
      .where("companyId", "=", f.companyId)
      .where("employeeId", "=", USER)
      .where("date", "=", DAY)
      .execute();
    expect(
      rows.map((row) => ({
        workCenterId: row.workCenterId,
        hours: Number(row.hours),
        overtimeHours: Number(row.overtimeHours)
      }))
    ).toEqual([{ workCenterId: mill, hours: 8, overtimeHours: 2 }]);
  } finally {
    await f.cleanup();
  }
});

databaseTest("a person still holds one row per station, day and shift", async () => {
  const { f, lathe } = await peopleFixture();
  try {
    const row = {
      companyId: f.companyId,
      locationId: f.locationId,
      workCenterId: lathe,
      employeeId: USER,
      date: DAY,
      shiftId: null,
      createdBy: USER
    };
    await f.db.insertInto("peopleAssignment").values(row).execute();
    await expect(
      f.db.insertInto("peopleAssignment").values(row).execute()
    ).rejects.toMatchObject({ code: "23505" });
  } finally {
    await f.cleanup();
  }
});
