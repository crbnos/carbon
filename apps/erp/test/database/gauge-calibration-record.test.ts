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
  theirRecord: `${prefix}-their-record`
};

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
      .values({
        id: ids.user,
        email: `${prefix}@carbon.ms`,
        firstName: "Calibration",
        lastName: "Test"
      })
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
      .insertInto("gauge")
      .values([
        [ids.ourGauge, ids.ourType, ids.ours],
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
    await trx.deleteFrom("user").where("id", "=", ids.user).execute();
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
