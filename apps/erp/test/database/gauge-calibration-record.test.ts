// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one. The
// calibration record operations write without row-level security, so their
// own company filters and row locks are what keep another company's rows out
// and the gauge in step with the flags.

import { createServiceContext } from "@carbon/api/service-fn.server";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createGaugeCalibrationRecord,
  updateGaugeCalibrationRecord
} from "../../app/modules/quality/quality.server";
import {
  connectLocalTestDatabase,
  hasLocalDatabase
} from "./fixtures/local-database";

const describeLocal = describe.skipIf(!hasLocalDatabase);
const TIMEOUT = 60_000;

const prefix = `gcrtest-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const ids = {
  user: `${prefix}-user`,
  ours: `${prefix}-ours`,
  ourGroup: `${prefix}-our-group`,
  theirs: `${prefix}-theirs`,
  theirGroup: `${prefix}-their-group`,
  ourType: `${prefix}-our-type`,
  theirType: `${prefix}-their-type`,
  ourGauge: `${prefix}-our-gauge`,
  theirGauge: `${prefix}-their-gauge`,
  theirRecord: `${prefix}-their-record`,
  // One gauge per correction case, so the cases do not share a summary.
  earlierGauge: `${prefix}-earlier-gauge`,
  fromGauge: `${prefix}-from-gauge`,
  toGauge: `${prefix}-to-gauge`,
  raceGauge: `${prefix}-race-gauge`,
  raceToGauge: `${prefix}-race-to-gauge`,
  referenceGauge: `${prefix}-reference-gauge`,
  ourSupplier: `${prefix}-our-supplier`,
  theirSupplier: `${prefix}-their-supplier`,
  employeeType: `${prefix}-employee-type`,
  // An employee of ours who has left, and an employee of the other company.
  departed: `${prefix}-departed`,
  outsider: `${prefix}-outsider`
};
const ourGauges = [
  ids.ourGauge,
  ids.earlierGauge,
  ids.fromGauge,
  ids.toGauge,
  ids.raceGauge,
  ids.raceToGauge,
  ids.referenceGauge
];

type Db = Kysely<KyselyDatabase>;
let db: Db;

// Quality → Records alone: the gauge moves as the system, after it.
const records = (actions: ("view" | "create" | "update")[]) => ({
  "quality.records": {
    view: actions.includes("view") ? [ids.ours] : [],
    create: actions.includes("create") ? [ids.ours] : [],
    update: actions.includes("update") ? [ids.ours] : [],
    delete: []
  }
});

/** A handle the operations never take: any use of it fails the test. */
const unavailable = (name: string) =>
  new Proxy({} as never, {
    get() {
      throw new Error(`The calibration operations use no ${name}`);
    }
  });

const ctx = (
  actions: ("view" | "create" | "update")[] = ["view", "create", "update"]
) =>
  createServiceContext({
    actor: {
      type: "user",
      role: "employee",
      userId: ids.user,
      permissions: records(actions)
    },
    company: { id: ids.ours, groupId: ids.ourGroup },
    caller: unavailable("caller client"),
    system: () => unavailable("service-role client"),
    pg: () => db,
    kv: () => unavailable("kv")
  });

// A Pass on a gauge with a 6-month interval, calibrated far ahead of today so
// its next date has not passed.
const calibration = {
  gaugeId: ids.ourGauge,
  dateCalibrated: "2400-01-15",
  calibrationAttempts: [{ reference: 10, actual: 10.01 }]
};

const gauge = (id: string) =>
  db
    .selectFrom("gauge")
    .select([
      "gaugeCalibrationStatus",
      "lastCalibrationDate",
      "nextCalibrationDate"
    ])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

const record = (id: string) =>
  db
    .selectFrom("gaugeCalibrationRecord")
    .select(["inspectionStatus", "requiresRepair", "dateCalibrated"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

async function waitUntilBlockedBy(monitor: Db, blockerPid: number) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const { rows } = await sql<{ blocked: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))
      ) AS blocked
    `.execute(monitor);
    if (rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The save never waited for the held record lock");
}

beforeAll(async () => {
  if (!hasLocalDatabase) return;
  db = await connectLocalTestDatabase();
  await db.transaction().execute(async (trx) => {
    // No triggers: a company here needs none of what a seed makes.
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    await trx
      .insertInto("user")
      .values(
        [ids.user, ids.departed, ids.outsider].map((id) => ({
          id,
          email: `${id}@carbon.ms`,
          firstName: "Calibration",
          lastName: "Test"
        }))
      )
      .execute();
    await trx
      .insertInto("companyGroup")
      .values([
        { id: ids.ourGroup, name: prefix, createdBy: ids.user },
        { id: ids.theirGroup, name: prefix, createdBy: ids.user }
      ])
      .execute();
    await trx
      .insertInto("company")
      .values(
        [
          [ids.ours, ids.ourGroup],
          [ids.theirs, ids.theirGroup]
        ].map(([id, companyGroupId]) => ({
          id: id!,
          name: id!,
          companyGroupId,
          baseCurrencyCode: "USD",
          timezone: "America/New_York"
        }))
      )
      .execute();
    await trx
      .insertInto("gaugeType")
      .values([
        { id: ids.ourType, name: prefix, companyId: ids.ours, createdBy: ids.user },
        { id: ids.theirType, name: prefix, companyId: ids.theirs, createdBy: ids.user }
      ])
      .execute();
    await trx
      .insertInto("employee")
      .values([
        { id: ids.user, companyId: ids.ours, active: true },
        { id: ids.departed, companyId: ids.ours, active: false },
        { id: ids.outsider, companyId: ids.theirs, active: true }
      ].map((employee) => ({ ...employee, employeeTypeId: ids.employeeType })))
      .execute();
    await trx
      .insertInto("supplier")
      .values([
        { id: ids.ourSupplier, companyId: ids.ours },
        { id: ids.theirSupplier, companyId: ids.theirs }
      ].map((supplier) => ({
        ...supplier,
        name: supplier.id,
        createdBy: ids.user
      })))
      .execute();
    await trx
      .insertInto("gauge")
      .values([
        ...ourGauges.map((id) => [id, ids.ourType, ids.ours]),
        [ids.theirGauge, ids.theirType, ids.theirs]
      ].map(([id, gaugeTypeId, companyId]) => ({
        id: id!,
        gaugeId: id!,
        gaugeTypeId: gaugeTypeId!,
        companyId: companyId!,
        calibrationIntervalInMonths: 6,
        createdBy: ids.user
      })))
      .execute();
    await trx
      .insertInto("gaugeCalibrationRecord")
      .values({
        id: ids.theirRecord,
        gaugeId: ids.theirGauge,
        dateCalibrated: "2400-01-01",
        inspectionStatus: "Pass",
        companyId: ids.theirs,
        createdBy: ids.user
      })
      .execute();
  });
});

afterAll(async () => {
  if (!hasLocalDatabase) return;
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    for (const companyId of [ids.ours, ids.theirs]) {
      await trx.deleteFrom("company").where("id", "=", companyId).execute();
      await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
        trx
      );
      await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
        trx
      );
    }
    await trx
      .deleteFrom("companyGroup")
      .where("id", "in", [ids.ourGroup, ids.theirGroup])
      .execute();
    await trx
      .deleteFrom("user")
      .where("id", "in", [ids.user, ids.departed, ids.outsider])
      .execute();
  });
  await db.destroy();
});

describeLocal("a calibration record operation", () => {
  it("records the gauge's latest calibration on the gauge", async () => {
    const created = await createGaugeCalibrationRecord(ctx(), calibration);

    expect(created.error).toBeNull();
    expect(await record(created.data!.id)).toEqual({
      inspectionStatus: "Pass",
      requiresRepair: false,
      dateCalibrated: "2400-01-15"
    });
    expect(await gauge(ids.ourGauge)).toEqual({
      gaugeCalibrationStatus: "In-Calibration",
      lastCalibrationDate: "2400-01-15",
      nextCalibrationDate: "2400-07-15"
    });
  }, TIMEOUT);

  // A flag left out keeps the value the record holds when the write runs,
  // and the result and the gauge follow it.
  it("decides the result from the flags committed while it waited", async () => {
    const created = await createGaugeCalibrationRecord(ctx(), {
      ...calibration,
      dateCalibrated: "2400-02-01"
    });
    const id = created.data!.id;
    // The save holds the fixture's one connection while it waits, so the
    // other save and the check that it waits each need their own.
    const other = await connectLocalTestDatabase();
    const monitor = await connectLocalTestDatabase();
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held!: (pid: number) => void;
    const holding = new Promise<number>((resolve) => {
      held = resolve;
    });
    try {
      // Another save ticks Requires repair and holds its transaction open.
      const repair = other.transaction().execute(async (trx) => {
        await trx
          .updateTable("gaugeCalibrationRecord")
          .set({ requiresRepair: true })
          .where("id", "=", id)
          .where("companyId", "=", ids.ours)
          .execute();
        const { rows } = await sql<{
          pid: number;
        }>`SELECT pg_backend_pid() AS pid`.execute(trx);
        held(rows[0]!.pid);
        await released;
      });
      const pid = await holding;

      const saving = updateGaugeCalibrationRecord(ctx(), {
        ...calibration,
        dateCalibrated: "2400-02-01",
        id
      });
      await waitUntilBlockedBy(monitor, pid);
      release();
      await repair;

      expect((await saving).error).toBeNull();
      expect(await record(id)).toEqual({
        inspectionStatus: "Fail",
        requiresRepair: true,
        dateCalibrated: "2400-02-01"
      });
      expect((await gauge(ids.ourGauge)).gaugeCalibrationStatus).toBe(
        "Out-of-Calibration"
      );
    } finally {
      release();
      await Promise.all([other.destroy(), monitor.destroy()]);
    }
  }, TIMEOUT);

  // The form decides the result from the flags; a contradicting one is not
  // saved, on a create or an update.
  it(
    "refuses a Pass on a calibration that requires repair, and saves nothing",
    async () => {
      const before = await gauge(ids.ourGauge);
      const created = await createGaugeCalibrationRecord(ctx(), {
        ...calibration,
        dateCalibrated: "2402-01-01",
        requiresRepair: true,
        inspectionStatus: "Pass"
      });
      const saved = await createGaugeCalibrationRecord(ctx(), {
        ...calibration,
        dateCalibrated: "2402-02-01"
      });
      const updated = await updateGaugeCalibrationRecord(ctx(), {
        ...calibration,
        dateCalibrated: "2402-03-01",
        requiresRepair: true,
        inspectionStatus: "Pass",
        id: saved.data!.id
      });

      expect(created.error?.category).toBe("validation");
      expect(updated.error?.category).toBe("validation");
      expect(await record(saved.data!.id)).toEqual({
        inspectionStatus: "Pass",
        requiresRepair: false,
        dateCalibrated: "2402-02-01"
      });
      const refused = await db
        .selectFrom("gaugeCalibrationRecord")
        .select("id")
        .where("gaugeId", "=", ids.ourGauge)
        .where("dateCalibrated", "in", ["2402-01-01", "2402-03-01"])
        .execute();
      expect(refused).toEqual([]);
      expect(before.lastCalibrationDate).not.toBe("2402-03-01");
      expect((await gauge(ids.ourGauge)).lastCalibrationDate).toBe(
        "2402-02-01"
      );
    },
    TIMEOUT
  );

  it("refuses another company's calibration record and leaves it alone", async () => {
    const result = await updateGaugeCalibrationRecord(ctx(), {
      ...calibration,
      dateCalibrated: "2400-12-01",
      id: ids.theirRecord
    });

    expect(result.error?.category).toBe("notFound");
    expect(await record(ids.theirRecord)).toEqual({
      inspectionStatus: "Pass",
      requiresRepair: false,
      dateCalibrated: "2400-01-01"
    });
  }, TIMEOUT);

  it("refuses another company's gauge and records nothing on it", async () => {
    const result = await createGaugeCalibrationRecord(ctx(), {
      ...calibration,
      gaugeId: ids.theirGauge
    });

    expect(result.error?.category).toBe("notFound");
    const records = await db
      .selectFrom("gaugeCalibrationRecord")
      .select("id")
      .where("gaugeId", "=", ids.theirGauge)
      .execute();
    expect(records).toEqual([{ id: ids.theirRecord }]);
    expect(await gauge(ids.theirGauge)).toEqual({
      gaugeCalibrationStatus: "Pending",
      lastCalibrationDate: null,
      nextCalibrationDate: null
    });
  }, TIMEOUT);

  // The form picks a new record's id first and uploads its files there.
  it("creates the record under the id the caller picked", async () => {
    const id = `${prefix}-picked`;

    const result = await createGaugeCalibrationRecord(ctx(["view", "create"]), {
      ...calibration,
      dateCalibrated: "2403-01-01",
      id
    });

    expect(result).toEqual({ data: { id }, error: null });
    expect(await record(id)).toEqual({
      inspectionStatus: "Pass",
      requiresRepair: false,
      dateCalibrated: "2403-01-01"
    });
  }, TIMEOUT);
});

// The calibration form can change a saved record's gauge and date, so a
// correction can take away the calibration a gauge shows.
describeLocal("correcting the calibration a gauge shows", () => {
  it("moved earlier, the gauge shows its latest calibration after the correction", async () => {
    const on = { ...calibration, gaugeId: ids.earlierGauge };
    const may = await createGaugeCalibrationRecord(ctx(), {
      ...on,
      dateCalibrated: "2410-05-01"
    });
    const june = await createGaugeCalibrationRecord(ctx(), {
      ...on,
      dateCalibrated: "2410-06-01",
      requiresRepair: true
    });
    expect([may.error, june.error]).toEqual([null, null]);
    expect(await gauge(ids.earlierGauge)).toEqual({
      gaugeCalibrationStatus: "Out-of-Calibration",
      lastCalibrationDate: "2410-06-01",
      nextCalibrationDate: "2410-12-01"
    });

    const corrected = await updateGaugeCalibrationRecord(ctx(), {
      ...on,
      dateCalibrated: "2410-04-01",
      id: june.data!.id
    });

    expect(corrected.error).toBeNull();
    // The May Pass is now the latest; the June Fail moved before it.
    expect(await gauge(ids.earlierGauge)).toEqual({
      gaugeCalibrationStatus: "In-Calibration",
      lastCalibrationDate: "2410-05-01",
      nextCalibrationDate: "2410-11-01"
    });
  }, TIMEOUT);

  it("moved to another gauge, the gauge it left shows its latest remaining calibration, or none", async () => {
    const march = await createGaugeCalibrationRecord(ctx(), {
      ...calibration,
      gaugeId: ids.fromGauge,
      dateCalibrated: "2411-03-01"
    });
    const april = await createGaugeCalibrationRecord(ctx(), {
      ...calibration,
      gaugeId: ids.fromGauge,
      dateCalibrated: "2411-04-01",
      requiresAdjustment: true
    });
    expect([march.error, april.error]).toEqual([null, null]);

    const moved = await updateGaugeCalibrationRecord(ctx(), {
      ...calibration,
      gaugeId: ids.toGauge,
      dateCalibrated: "2411-04-01",
      id: april.data!.id
    });

    expect(moved.error).toBeNull();
    expect(await gauge(ids.fromGauge)).toEqual({
      gaugeCalibrationStatus: "In-Calibration",
      lastCalibrationDate: "2411-03-01",
      nextCalibrationDate: "2411-09-01"
    });
    expect(await gauge(ids.toGauge)).toEqual({
      gaugeCalibrationStatus: "Out-of-Calibration",
      lastCalibrationDate: "2411-04-01",
      nextCalibrationDate: "2411-10-01"
    });

    const last = await updateGaugeCalibrationRecord(ctx(), {
      ...calibration,
      gaugeId: ids.toGauge,
      dateCalibrated: "2411-03-01",
      id: march.data!.id
    });

    expect(last.error).toBeNull();
    expect(await gauge(ids.fromGauge)).toEqual({
      gaugeCalibrationStatus: "Pending",
      lastCalibrationDate: null,
      nextCalibrationDate: null
    });
    // March is older than the April the gauge already shows.
    expect(await gauge(ids.toGauge)).toEqual({
      gaugeCalibrationStatus: "Out-of-Calibration",
      lastCalibrationDate: "2411-04-01",
      nextCalibrationDate: "2411-10-01"
    });
  }, TIMEOUT);

  // The gauge it leaves is read under its lock: a calibration another save
  // committed while this one waited is what the gauge then shows.
  it("moved away, the gauge shows a calibration committed while the save waited on it", async () => {
    const on = { ...calibration, gaugeId: ids.raceGauge };
    await createGaugeCalibrationRecord(ctx(), {
      ...on,
      dateCalibrated: "2412-03-01"
    });
    const june = await createGaugeCalibrationRecord(ctx(), {
      ...on,
      dateCalibrated: "2412-06-01"
    });
    const other = await connectLocalTestDatabase();
    const monitor = await connectLocalTestDatabase();
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held!: (pid: number) => void;
    const holding = new Promise<number>((resolve) => {
      held = resolve;
    });
    try {
      // Another save holds the gauge and records May under it.
      const recording = other.transaction().execute(async (trx) => {
        await trx
          .selectFrom("gauge")
          .select("id")
          .where("id", "=", ids.raceGauge)
          .where("companyId", "=", ids.ours)
          .forUpdate()
          .execute();
        await trx
          .insertInto("gaugeCalibrationRecord")
          .values({
            gaugeId: ids.raceGauge,
            dateCalibrated: "2412-05-01",
            inspectionStatus: "Fail",
            requiresRepair: true,
            companyId: ids.ours,
            createdBy: ids.user
          })
          .execute();
        const { rows } = await sql<{
          pid: number;
        }>`SELECT pg_backend_pid() AS pid`.execute(trx);
        held(rows[0]!.pid);
        await released;
      });
      const pid = await holding;

      const moving = updateGaugeCalibrationRecord(ctx(), {
        ...calibration,
        gaugeId: ids.raceToGauge,
        dateCalibrated: "2412-06-01",
        id: june.data!.id
      });
      await waitUntilBlockedBy(monitor, pid);
      release();
      await recording;

      expect((await moving).error).toBeNull();
      expect(await gauge(ids.raceGauge)).toEqual({
        gaugeCalibrationStatus: "Out-of-Calibration",
        lastCalibrationDate: "2412-05-01",
        nextCalibrationDate: "2412-11-01"
      });
    } finally {
      release();
      await Promise.all([other.destroy(), monitor.destroy()]);
    }
  }, TIMEOUT);
});

// The supplier and approver columns reference the global tables, and the
// write bypasses row-level security.
describeLocal("a calibration record's supplier and approver", () => {
  const on = { ...calibration, gaugeId: ids.referenceGauge };
  const saved = (dateCalibrated: string) =>
    db
      .selectFrom("gaugeCalibrationRecord")
      .select(["supplierId", "approvedBy"])
      .where("gaugeId", "=", ids.referenceGauge)
      .where("dateCalibrated", "=", dateCalibrated)
      .execute();

  it.each([
    ["another company's supplier", { supplierId: ids.theirSupplier }, "notFound"],
    ["an employee of another company", { approvedBy: ids.outsider }, "validation"],
    ["an employee who has left", { approvedBy: ids.departed }, "validation"]
  ])("refuses %s on a create, and saves nothing", async (_name, fields, category) => {
    const result = await createGaugeCalibrationRecord(ctx(), {
      ...on,
      dateCalibrated: "2413-01-01",
      ...fields
    });

    expect(result.error?.category).toBe(category);
    expect(await saved("2413-01-01")).toEqual([]);
    expect(await gauge(ids.referenceGauge)).toEqual({
      gaugeCalibrationStatus: "Pending",
      lastCalibrationDate: null,
      nextCalibrationDate: null
    });
  }, TIMEOUT);

  it("refuses a change to another company's supplier or approver on an update", async () => {
    const created = await createGaugeCalibrationRecord(ctx(), {
      ...on,
      dateCalibrated: "2413-02-01",
      supplierId: ids.ourSupplier,
      approvedBy: ids.user
    });
    expect(created.error).toBeNull();

    const supplier = await updateGaugeCalibrationRecord(ctx(), {
      ...on,
      dateCalibrated: "2413-02-01",
      supplierId: ids.theirSupplier,
      id: created.data!.id
    });
    const approver = await updateGaugeCalibrationRecord(ctx(), {
      ...on,
      dateCalibrated: "2413-02-01",
      approvedBy: ids.outsider,
      id: created.data!.id
    });

    expect([supplier.error?.category, approver.error?.category]).toEqual([
      "notFound",
      "validation"
    ]);
    expect(await saved("2413-02-01")).toEqual([
      { supplierId: ids.ourSupplier, approvedBy: ids.user }
    ]);
  }, TIMEOUT);

  // The form sends an emptied field as nothing, and its save clears it.
  it("an update clears the fields left out that the form empties, and keeps the notes", async () => {
    const created = await createGaugeCalibrationRecord(ctx(), {
      ...on,
      dateCalibrated: "2413-04-01",
      supplierId: ids.ourSupplier,
      approvedBy: ids.user,
      temperature: 20,
      humidity: 0.5,
      measurementStandard: "NIST",
      notes: "Checked against block 3"
    });
    expect(created.error).toBeNull();
    const id = created.data!.id;
    const fields = () =>
      db
        .selectFrom("gaugeCalibrationRecord")
        .select([
          "supplierId",
          "approvedBy",
          "temperature",
          "humidity",
          "measurementStandard",
          "notes"
        ])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
    const before = await fields();

    const updated = await updateGaugeCalibrationRecord(ctx(), {
      ...on,
      dateCalibrated: "2413-04-01",
      id
    });

    expect(updated.error).toBeNull();
    expect(await fields()).toEqual({
      supplierId: null,
      approvedBy: null,
      temperature: null,
      humidity: null,
      measurementStandard: null,
      notes: before.notes
    });
  }, TIMEOUT);

  // The form posts the saved approver on every edit.
  it("saves a record whose unchanged approver has since left", async () => {
    const { id } = await db
      .insertInto("gaugeCalibrationRecord")
      .values({
        gaugeId: ids.referenceGauge,
        dateCalibrated: "2413-03-01",
        inspectionStatus: "Pass",
        approvedBy: ids.departed,
        companyId: ids.ours,
        createdBy: ids.user
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const result = await updateGaugeCalibrationRecord(ctx(), {
      ...on,
      dateCalibrated: "2413-03-01",
      approvedBy: ids.departed,
      measurementStandard: "NIST",
      id
    });

    expect(result).toEqual({ data: { id }, error: null });
  }, TIMEOUT);
});
