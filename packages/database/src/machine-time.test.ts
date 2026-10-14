// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "kysely";
import { CompiledQuery, Kysely, PostgresDialect, PostgresDriver } from "kysely";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { KyselyDatabase } from "./client.ts";
import {
  endSensorMachineTime,
  recordManualMachinePress
} from "./machine-time.ts";

// Runs against the local database, like the authz tests:
//   SUPABASE_DB_URL=… pnpm --filter @carbon/database test -- machine-time
//
// Each test runs inside one transaction that is always rolled back, so it
// writes nothing. Fixtures are inserted with `session_replication_role =
// replica` (FKs and triggers off), so a Machine event needs no job behind it.
const url = process.env.SUPABASE_DB_URL;

class SavepointDriver extends PostgresDriver {
  override async beginTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(CompiledQuery.raw("SAVEPOINT engine"));
  }
  override async commitTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(
      CompiledQuery.raw("RELEASE SAVEPOINT engine")
    );
  }
  override async rollbackTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(
      CompiledQuery.raw("ROLLBACK TO SAVEPOINT engine")
    );
  }
}

type Row = Record<string, unknown>;

describe.skipIf(!url)("machine time against a migrated database", () => {
  const client = new Client({ connectionString: url });
  const config = {
    pool: {
      connect: async () => Object.assign(client, { release: () => undefined }),
      end: async () => undefined
    }
  };
  const dialect = new PostgresDialect(config);
  const db = new Kysely<KyselyDatabase>({
    dialect: {
      createAdapter: () => dialect.createAdapter(),
      createDriver: () => new SavepointDriver(config),
      createIntrospector: (k) => dialect.createIntrospector(k),
      createQueryCompiler: () => dialect.createQueryCompiler()
    }
  });

  const run = randomUUID().slice(0, 8);
  const id = (name: string) => `t-${run}-${name}`;
  const companyId = id("company");
  const workCenterId = id("wc");
  const otherWorkCenterId = id("wc-other");
  const operator = id("operator");

  const before = "2026-10-13T08:00:00.000Z";
  const at = "2026-10-13T09:00:00.000Z";
  const after = "2026-10-13T09:30:00.000Z";

  async function insert(table: string, given: Row) {
    const row: Row = { companyId, createdBy: "system", ...given };
    const columns = Object.keys(row);
    await client.query(
      `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
      Object.values(row)
    );
  }

  async function machineEvent(rowId: string, given: Row = {}) {
    await insert("productionEvent", {
      id: id(rowId),
      jobOperationId: id("op"),
      workCenterId,
      type: "Machine",
      startTime: before,
      ...given
    });
  }

  async function unattributed(rowId: string, given: Row = {}) {
    await insert("unattributedMachineTime", {
      id: id(rowId),
      workCenterId,
      startTime: before,
      ...given
    });
  }

  /** Whether the row ended exactly at `at`, or is still open (null). */
  async function endedAt(table: string, rowId: string) {
    const result = await client.query(
      `SELECT "endTime" IS NULL AS open, "endTime" = $2::timestamptz AS "atPress"
       FROM "${table}" WHERE "id" = $1`,
      [id(rowId), at]
    );
    const row = result.rows[0] as { open: boolean; atPress: boolean | null };
    return row.open ? null : row.atPress;
  }

  async function seed() {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await insert("workCenterDevice", {
      id: id("device"),
      workCenterId,
      integration: "sense",
      externalDeviceId: id("station"),
      deviceName: "Station"
    });
  }

  beforeAll(async () => {
    await client.connect();
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  afterAll(async () => {
    await client.end();
  });

  describe("recordManualMachinePress", () => {
    it("ends open unattributed time at the press, so it is not counted twice", async () => {
      await seed();
      await unattributed("running");
      await unattributed("later", { startTime: after });
      await unattributed("other-wc", { workCenterId: otherWorkCenterId });

      const result = await db.transaction().execute((trx) =>
        recordManualMachinePress(trx, {
          workCenterId,
          companyId,
          userId: operator,
          pressedAt: at
        })
      );

      expect(result.mapped).toBe(true);
      expect(await endedAt("unattributedMachineTime", "running")).toBe(true);
      // Started after the press: the sync still owns it.
      expect(await endedAt("unattributedMachineTime", "later")).toBeNull();
      expect(await endedAt("unattributedMachineTime", "other-wc")).toBeNull();
    });

    it("records the press: never earlier than the last one, and keeps the earliest unplanned one", async () => {
      await seed();
      const press = (pressedAt: string) =>
        db.transaction().execute((trx) =>
          recordManualMachinePress(trx, {
            workCenterId,
            companyId,
            userId: operator,
            pressedAt
          })
        );
      // A late press with an earlier time must not move the latest back.
      await press(at);
      await press(after);
      await press(before);

      const result = await client.query(
        `SELECT "lastManualChangeAt" = $2::timestamptz AS "latest",
                "unplannedPressAt" = $3::timestamptz AS "earliest"
         FROM "workCenterDevice" WHERE "id" = $1`,
        [id("device"), after, before]
      );
      expect(result.rows[0]).toEqual({ latest: true, earliest: true });
    });

    it("takes the press time under the lock when none is given", async () => {
      await seed();
      const result = await db.transaction().execute((trx) =>
        recordManualMachinePress(trx, {
          workCenterId,
          companyId,
          userId: operator
        })
      );
      expect(Number.isNaN(Date.parse(result.pressedAt))).toBe(false);
    });

    it("ends another operator's Machine event", async () => {
      await seed();
      await machineEvent("operator", { createdBy: operator });

      await db.transaction().execute((trx) =>
        recordManualMachinePress(trx, {
          workCenterId,
          companyId,
          userId: id("other-operator"),
          pressedAt: at
        })
      );

      expect(await endedAt("productionEvent", "operator")).toBe(true);
    });

    it("does not end an event that starts after the press", async () => {
      await seed();
      await machineEvent("later", { startTime: after });

      await db.transaction().execute((trx) =>
        recordManualMachinePress(trx, {
          workCenterId,
          companyId,
          userId: operator,
          pressedAt: at
        })
      );

      expect(await endedAt("productionEvent", "later")).toBeNull();
    });

    it("ends Machine events on a work center with no device", async () => {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await machineEvent("running");

      const result = await db.transaction().execute((trx) =>
        recordManualMachinePress(trx, {
          workCenterId,
          companyId,
          userId: operator,
          pressedAt: at
        })
      );

      expect(result.mapped).toBe(false);
      expect(await endedAt("productionEvent", "running")).toBe(true);
    });

    it("leaves unattributed time on a work center with no device", async () => {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await unattributed("running");

      const result = await db.transaction().execute((trx) =>
        recordManualMachinePress(trx, {
          workCenterId,
          companyId,
          userId: operator,
          pressedAt: at
        })
      );

      expect(result.mapped).toBe(false);
      expect(await endedAt("unattributedMachineTime", "running")).toBeNull();
    });
  });

  describe("endSensorMachineTime", () => {
    it("ends the sensor's open time and leaves the operator's", async () => {
      await seed();
      await machineEvent("sensor");
      await machineEvent("operator", { createdBy: operator });
      await machineEvent("other-wc", { workCenterId: otherWorkCenterId });
      await unattributed("running");
      await unattributed("stopped", { endTime: before });

      await db.transaction().execute((trx) =>
        endSensorMachineTime(trx, {
          workCenterId,
          companyId,
          userId: operator,
          at
        })
      );

      expect(await endedAt("productionEvent", "sensor")).toBe(true);
      expect(await endedAt("productionEvent", "operator")).toBeNull();
      expect(await endedAt("productionEvent", "other-wc")).toBeNull();
      expect(await endedAt("unattributedMachineTime", "running")).toBe(true);
      // Already stopped: its end stays where the sync put it.
      expect(await endedAt("unattributedMachineTime", "stopped")).toBe(false);
    });
  });
});
