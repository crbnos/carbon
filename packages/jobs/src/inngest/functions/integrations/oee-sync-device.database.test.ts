// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// One OEE device's sync against a live local database: the read window it
// asks the provider for, and the Machine time it writes under the device lock.
//   SUPABASE_DB_URL=… pnpm --filter @carbon/jobs exec vitest run oee-sync-device
//
// Each test runs inside one transaction that is always rolled back, so it
// writes nothing. Fixtures are inserted with `session_replication_role =
// replica` (FKs and triggers off): the load interceptor does not run, so the
// work center's loaded operation is set directly. The provider is the one
// fake — it is the HTTP boundary — and the wall clock is pinned.

import { randomUUID } from "node:crypto";
import type { KyselyDatabase } from "@carbon/database/client";
import type { OeeProvider, OeeStateChange } from "@carbon/ee/oee";
import type { DatabaseConnection } from "kysely";
import { CompiledQuery, Kysely, PostgresDialect, PostgresDriver } from "kysely";
import { Client } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { syncOeeDevice } from "./oee-sync-device";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const hasLocalDatabase = (() => {
  try {
    return LOCAL_HOSTS.includes(
      new URL(process.env.SUPABASE_DB_URL ?? "").hostname
    );
  } catch {
    return false;
  }
})();

/** `syncOeeDevice` opens its own transaction: run it as a savepoint. */
class SavepointDriver extends PostgresDriver {
  override async beginTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(CompiledQuery.raw("SAVEPOINT sync"));
  }
  override async commitTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(CompiledQuery.raw("RELEASE SAVEPOINT sync"));
  }
  override async rollbackTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(
      CompiledQuery.raw("ROLLBACK TO SAVEPOINT sync")
    );
  }
}

type Row = Record<string, unknown>;

/** A timestamptz column as a UTC ISO string, whatever the session timezone. */
const iso = (column: string) =>
  `to_char("${column}" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

describe.skipIf(!hasLocalDatabase)(
  "syncOeeDevice against a migrated database",
  () => {
    const client = new Client({
      connectionString: process.env.SUPABASE_DB_URL
    });
    const config = {
      pool: {
        connect: async () =>
          Object.assign(client, { release: () => undefined }),
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
    const deviceId = id("device");
    const operationId = id("op");

    const now = "2026-10-13T12:00:00.000Z";
    const mappedAt = "2026-10-13T08:00:00.000Z";

    async function insert(table: string, given: Row) {
      const row: Row = { companyId, createdBy: "system", ...given };
      const columns = Object.keys(row);
      await client.query(
        `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
        Object.values(row)
      );
    }

    /**
     * A work center with a mapped device and one job operation. `workCenter`
     * sets its loaded operation; `device` the device's sync state.
     */
    async function seed({
      workCenter = {},
      device = {},
      operation = {}
    }: {
      workCenter?: Row;
      device?: Row;
      operation?: Row;
    } = {}) {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      // The load lives in workCenterLoad; a seeded load is written there.
      const { loadedJobOperationId, loadedAt, ...workCenterColumns } =
        workCenter;
      await insert("workCenter", {
        id: workCenterId,
        name: "Mill",
        ...workCenterColumns
      });
      await insert("jobOperation", {
        id: operationId,
        jobId: id("job"),
        processId: id("process"),
        status: "In Progress",
        ...operation
      });
      // Triggers are off here, so the load the interceptor would write is
      // seeded directly.
      if (loadedJobOperationId && loadedAt) {
        await client.query(
          `INSERT INTO "workCenterLoad" ("companyId", "workCenterId", "jobOperationId", "loadedAt")
           VALUES ($1, $2, $3, $4)`,
          [companyId, workCenterId, loadedJobOperationId, loadedAt]
        );
      }
      await insert("workCenterDevice", {
        id: deviceId,
        workCenterId,
        integration: "sense",
        externalDeviceId: id("station"),
        deviceName: "Station",
        createdAt: mappedAt,
        ...device
      });
    }

    /** The device row as the sweep reads it. */
    async function readDevice() {
      return db
        .selectFrom("workCenterDevice")
        .selectAll()
        .where("id", "=", deviceId)
        .executeTakeFirstOrThrow();
    }

    /** A provider that returns fixed changes and records each read window. */
    function fakeProvider(
      changes: OeeStateChange[],
      onRead: () => Promise<void> = async () => undefined
    ) {
      const windows: { since: string; until: string }[] = [];
      const provider: OeeProvider = {
        id: "sense",
        validate: async () => ({ valid: true }),
        listDevices: async () => [],
        listStateChanges: async (_device, window) => {
          windows.push(window);
          await onRead();
          return changes;
        }
      };
      return { provider, windows };
    }

    async function sync(provider: OeeProvider) {
      return syncOeeDevice({
        db,
        provider,
        device: await readDevice(),
        minimumStateSeconds: 60
      });
    }

    async function machineEvents() {
      const result = await client.query(
        `SELECT "jobOperationId", "createdBy", "employeeId",
              ${iso("startTime")} AS "startTime", ${iso("endTime")} AS "endTime"
       FROM "productionEvent"
       WHERE "workCenterId" = $1 AND "type" = 'Machine'
       ORDER BY "startTime"`,
        [workCenterId]
      );
      return result.rows as Row[];
    }

    async function unattributedTime() {
      const result = await client.query(
        `SELECT ${iso("startTime")} AS "startTime", ${iso("endTime")} AS "endTime"
       FROM "unattributedMachineTime"
       WHERE "workCenterId" = $1
       ORDER BY "startTime"`,
        [workCenterId]
      );
      return result.rows as Row[];
    }

    async function deviceState() {
      const result = await client.query(
        `SELECT "currentState", ${iso("appliedThrough")} AS "appliedThrough",
              ${iso("lastEventAt")} AS "lastEventAt"
       FROM "workCenterDevice" WHERE "id" = $1`,
        [deviceId]
      );
      return result.rows[0] as Row;
    }

    beforeAll(async () => {
      await client.connect();
    });

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
    });

    afterEach(async () => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      await client.query("ROLLBACK");
    });

    afterAll(async () => {
      await client.end();
    });

    it("reads a first sync from 24 hours before the mapping", async () => {
      await seed();
      const { provider, windows } = fakeProvider([]);

      await sync(provider);

      expect(windows).toEqual([
        { since: "2026-10-12T08:00:00.000Z", until: now }
      ]);
    });

    it("reads a later sync from 10 minutes before the last event", async () => {
      await seed({
        device: {
          lastSyncedAt: "2026-10-13T11:58:00.000Z",
          lastEventAt: "2026-10-13T11:00:00.000Z"
        }
      });
      const { provider, windows } = fakeProvider([]);

      await sync(provider);

      expect(windows).toEqual([
        { since: "2026-10-13T10:50:00.000Z", until: now }
      ]);
    });

    it("opens a system Machine event on the loaded operation when the machine runs", async () => {
      await seed({
        workCenter: {
          loadedJobOperationId: operationId,
          loadedAt: "2026-10-13T10:00:00.000Z"
        },
        device: {
          currentState: "Idle",
          currentStateAt: "2026-10-13T09:00:00.000Z",
          appliedThrough: "2026-10-13T09:00:00.000Z",
          lastEventAt: "2026-10-13T09:00:00.000Z",
          lastSyncedAt: "2026-10-13T11:58:00.000Z"
        }
      });
      const { provider } = fakeProvider([
        {
          externalEventId: "run",
          state: "Running",
          changedAt: "2026-10-13T11:00:00.000Z"
        }
      ]);

      const result = await sync(provider);

      expect(await machineEvents()).toEqual([
        {
          jobOperationId: operationId,
          createdBy: "system",
          employeeId: null,
          startTime: "2026-10-13T11:00:00.000Z",
          endTime: null
        }
      ]);
      // An open event has nothing to post yet.
      expect(result.endedEventIds).toEqual([]);
      expect(await unattributedTime()).toEqual([]);
      expect(await deviceState()).toEqual({
        currentState: "Running",
        appliedThrough: "2026-10-13T11:00:00.000Z",
        lastEventAt: "2026-10-13T11:00:00.000Z"
      });
    });

    it("does not plan a change stored at or before appliedThrough, and warns once", async () => {
      await seed({
        workCenter: {
          loadedJobOperationId: operationId,
          loadedAt: "2026-10-13T09:00:00.000Z"
        },
        device: {
          currentState: "Running",
          currentStateAt: "2026-10-13T10:00:00.000Z",
          appliedThrough: "2026-10-13T11:00:00.000Z",
          lastEventAt: "2026-10-13T11:00:00.000Z",
          lastSyncedAt: "2026-10-13T11:58:00.000Z"
        }
      });
      await insert("productionEvent", {
        id: id("running"),
        jobOperationId: operationId,
        workCenterId,
        type: "Machine",
        startTime: "2026-10-13T10:00:00.000Z"
      });
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      // Stored late: the provider reports a stop older than what was applied.
      const { provider } = fakeProvider([
        {
          externalEventId: "late-stop",
          state: "Idle",
          changedAt: "2026-10-13T10:30:00.000Z"
        }
      ]);

      await sync(provider);

      expect(warn).toHaveBeenCalledTimes(1);
      // Planned, the stop would have ended the event at 10:30.
      expect(await machineEvents()).toEqual([
        {
          jobOperationId: operationId,
          createdBy: "system",
          employeeId: null,
          startTime: "2026-10-13T10:00:00.000Z",
          endTime: null
        }
      ]);
      expect(await deviceState()).toEqual({
        currentState: "Running",
        appliedThrough: "2026-10-13T11:00:00.000Z",
        lastEventAt: "2026-10-13T11:00:00.000Z"
      });
    });

    it("writes no time for a device removed while the provider was read", async () => {
      await seed({
        workCenter: {
          loadedJobOperationId: operationId,
          loadedAt: "2026-10-13T10:00:00.000Z"
        },
        device: {
          currentState: "Idle",
          currentStateAt: "2026-10-13T09:00:00.000Z",
          appliedThrough: "2026-10-13T09:00:00.000Z",
          lastEventAt: "2026-10-13T09:00:00.000Z",
          lastSyncedAt: "2026-10-13T11:58:00.000Z"
        }
      });
      const { provider } = fakeProvider(
        [
          {
            externalEventId: "run",
            state: "Running",
            changedAt: "2026-10-13T11:00:00.000Z"
          }
        ],
        async () => {
          await client.query(`DELETE FROM "workCenterDevice" WHERE "id" = $1`, [
            deviceId
          ]);
        }
      );

      await sync(provider);

      expect(await machineEvents()).toEqual([]);
      expect(await unattributedTime()).toEqual([]);
    });

    it("closes an open system event where its Canceled operation was unloaded", async () => {
      // Canceling the operation at 10:45 ended its load there.
      await seed({
        operation: {
          status: "Canceled",
          updatedAt: "2026-10-13T10:45:00.000Z"
        },
        device: {
          currentState: "Running",
          currentStateAt: "2026-10-13T10:00:00.000Z",
          appliedThrough: "2026-10-13T10:00:00.000Z",
          lastEventAt: "2026-10-13T10:00:00.000Z",
          lastSyncedAt: "2026-10-13T11:58:00.000Z"
        }
      });
      await insert("productionEvent", {
        id: id("running"),
        jobOperationId: operationId,
        workCenterId,
        type: "Machine",
        startTime: "2026-10-13T10:00:00.000Z"
      });
      await client.query(
        `INSERT INTO "workCenterLoad" ("companyId", "workCenterId", "jobOperationId", "loadedAt", "unloadedAt")
         VALUES ($1, $2, $3, $4, $5)`,
        [
          companyId,
          workCenterId,
          operationId,
          "2026-10-13T09:00:00.000Z",
          "2026-10-13T10:45:00.000Z"
        ]
      );
      const { provider } = fakeProvider([]);

      const result = await sync(provider);

      expect(await machineEvents()).toEqual([
        {
          jobOperationId: operationId,
          createdBy: "system",
          employeeId: null,
          startTime: "2026-10-13T10:00:00.000Z",
          endTime: "2026-10-13T10:45:00.000Z"
        }
      ]);
      // The event it ended goes to the caller to post.
      expect(result.endedEventIds).toEqual([id("running")]);
      // The machine still runs with nothing loaded: the rest is unattributed.
      expect(await unattributedTime()).toEqual([
        { startTime: "2026-10-13T10:45:00.000Z", endTime: null }
      ]);
    });

    it("records a run reported after the operator's press as unattributed, up to the press", async () => {
      // The machine started at 11:00; the operator pressed Start at 11:03,
      // before the provider reported the run.
      await seed({
        workCenter: {
          loadedJobOperationId: operationId,
          loadedAt: "2026-10-13T11:03:00.000Z"
        },
        device: {
          currentState: "Idle",
          currentStateAt: "2026-10-13T09:00:00.000Z",
          appliedThrough: "2026-10-13T09:00:00.000Z",
          lastEventAt: "2026-10-13T09:00:00.000Z",
          lastManualChangeAt: "2026-10-13T11:03:00.000Z",
          lastSyncedAt: "2026-10-13T11:02:00.000Z"
        }
      });
      await insert("productionEvent", {
        id: id("operator"),
        jobOperationId: operationId,
        workCenterId,
        type: "Machine",
        startTime: "2026-10-13T11:03:00.000Z",
        createdBy: "operator"
      });
      const { provider } = fakeProvider([
        {
          externalEventId: "run",
          state: "Running",
          changedAt: "2026-10-13T11:00:00.000Z"
        }
      ]);

      await sync(provider);

      expect(await unattributedTime()).toEqual([
        {
          startTime: "2026-10-13T11:00:00.000Z",
          endTime: "2026-10-13T11:03:00.000Z"
        }
      ]);
      // The operator's event is untouched, and the sensor opens none.
      expect(await machineEvents()).toEqual([
        {
          jobOperationId: operationId,
          createdBy: "operator",
          employeeId: null,
          startTime: "2026-10-13T11:03:00.000Z",
          endTime: null
        }
      ]);
    });

    it("records nothing for a late run that an operator's event already holds", async () => {
      // The operator ran Machine time from 10:30 and pressed Pause at 11:03.
      await seed({
        device: {
          currentState: "Idle",
          currentStateAt: "2026-10-13T09:00:00.000Z",
          appliedThrough: "2026-10-13T09:00:00.000Z",
          lastEventAt: "2026-10-13T09:00:00.000Z",
          lastManualChangeAt: "2026-10-13T11:03:00.000Z",
          lastSyncedAt: "2026-10-13T11:02:00.000Z"
        }
      });
      await insert("productionEvent", {
        id: id("operator"),
        jobOperationId: operationId,
        workCenterId,
        type: "Machine",
        startTime: "2026-10-13T10:30:00.000Z",
        endTime: "2026-10-13T11:03:00.000Z",
        createdBy: "operator"
      });
      // The machine stops 30 seconds after the Pause: no time after it.
      const { provider } = fakeProvider([
        {
          externalEventId: "run",
          state: "Running",
          changedAt: "2026-10-13T11:00:00.000Z"
        },
        {
          externalEventId: "stop",
          state: "Idle",
          changedAt: "2026-10-13T11:03:30.000Z"
        }
      ]);

      await sync(provider);

      expect(await unattributedTime()).toEqual([]);
    });

    it("gives a run reported after a press to the operation loaded when it started", async () => {
      // X was loaded from 10:00. The machine started at 11:00; at 11:03 the
      // operator pressed Start on Y, which loaded Y, before the provider
      // reported the run.
      await seed({
        workCenter: {
          loadedJobOperationId: operationId,
          loadedAt: "2026-10-13T11:03:00.000Z"
        },
        device: {
          currentState: "Idle",
          currentStateAt: "2026-10-13T09:00:00.000Z",
          appliedThrough: "2026-10-13T09:00:00.000Z",
          lastEventAt: "2026-10-13T09:00:00.000Z",
          lastManualChangeAt: "2026-10-13T11:03:00.000Z",
          lastSyncedAt: "2026-10-13T11:02:00.000Z"
        }
      });
      const earlier = id("op-x");
      await insert("jobOperation", {
        id: earlier,
        jobId: id("job"),
        processId: id("process"),
        status: "In Progress"
      });
      await client.query(
        `INSERT INTO "workCenterLoad" ("companyId", "workCenterId", "jobOperationId", "loadedAt", "unloadedAt")
         VALUES ($1, $2, $3, $4, $5)`,
        [
          companyId,
          workCenterId,
          earlier,
          "2026-10-13T10:00:00.000Z",
          "2026-10-13T11:03:00.000Z"
        ]
      );
      await insert("productionEvent", {
        id: id("operator"),
        jobOperationId: operationId,
        workCenterId,
        type: "Machine",
        startTime: "2026-10-13T11:03:00.000Z",
        createdBy: "operator"
      });
      const { provider } = fakeProvider([
        {
          externalEventId: "run",
          state: "Running",
          changedAt: "2026-10-13T11:00:00.000Z"
        }
      ]);

      await sync(provider);

      expect(await machineEvents()).toEqual([
        {
          jobOperationId: earlier,
          createdBy: "system",
          employeeId: null,
          startTime: "2026-10-13T11:00:00.000Z",
          endTime: "2026-10-13T11:03:00.000Z"
        },
        {
          jobOperationId: operationId,
          createdBy: "operator",
          employeeId: null,
          startTime: "2026-10-13T11:03:00.000Z",
          endTime: null
        }
      ]);
      expect(await unattributedTime()).toEqual([]);
    });

    it("queues the time a machine runs on after a Pause, up to its stop", async () => {
      // The operator ran Machine time from 10:30 and pressed Pause at 11:03;
      // the machine, running since 10:00, stopped at 11:30.
      await seed({
        workCenter: {
          loadedJobOperationId: operationId,
          loadedAt: "2026-10-13T10:30:00.000Z"
        },
        device: {
          currentState: "Running",
          currentStateAt: "2026-10-13T10:00:00.000Z",
          appliedThrough: "2026-10-13T10:00:00.000Z",
          lastEventAt: "2026-10-13T10:00:00.000Z",
          lastManualChangeAt: "2026-10-13T11:03:00.000Z",
          lastSyncedAt: "2026-10-13T11:02:00.000Z"
        }
      });
      await insert("productionEvent", {
        id: id("operator"),
        jobOperationId: operationId,
        workCenterId,
        type: "Machine",
        startTime: "2026-10-13T10:30:00.000Z",
        endTime: "2026-10-13T11:03:00.000Z",
        createdBy: "operator"
      });
      const { provider } = fakeProvider([
        {
          externalEventId: "stop",
          state: "Idle",
          changedAt: "2026-10-13T11:30:00.000Z"
        }
      ]);

      await sync(provider);

      expect(await unattributedTime()).toEqual([
        {
          startTime: "2026-10-13T11:03:00.000Z",
          endTime: "2026-10-13T11:30:00.000Z"
        }
      ]);
    });

    it("deletes closed unattributed time shorter than the minimum", async () => {
      await seed({
        device: {
          currentState: "Idle",
          currentStateAt: "2026-10-13T09:00:00.000Z",
          appliedThrough: "2026-10-13T09:00:00.000Z",
          lastEventAt: "2026-10-13T09:00:00.000Z",
          lastSyncedAt: "2026-10-13T11:58:00.000Z"
        }
      });
      await insert("unattributedMachineTime", {
        workCenterId,
        startTime: "2026-10-13T10:00:00.000Z",
        endTime: "2026-10-13T10:00:20.000Z"
      });
      await insert("unattributedMachineTime", {
        workCenterId,
        startTime: "2026-10-13T10:30:00.000Z",
        endTime: "2026-10-13T10:35:00.000Z"
      });

      await sync(fakeProvider([]).provider);

      expect(await unattributedTime()).toEqual([
        {
          startTime: "2026-10-13T10:30:00.000Z",
          endTime: "2026-10-13T10:35:00.000Z"
        }
      ]);
    });

    it("records the time between two presses no sync saw, and clears the press marker", async () => {
      // The machine runs from 09:00. The operator paused at 10:00 and started
      // again at 10:10, with no sync between.
      await seed({
        device: {
          currentState: "Running",
          currentStateAt: "2026-10-13T09:00:00.000Z",
          appliedThrough: "2026-10-13T09:00:00.000Z",
          lastEventAt: "2026-10-13T09:00:00.000Z",
          lastManualChangeAt: "2026-10-13T10:10:00.000Z",
          unplannedPressAt: "2026-10-13T10:00:00.000Z",
          lastSyncedAt: "2026-10-13T09:58:00.000Z"
        }
      });
      await insert("productionEvent", {
        id: id("first"),
        jobOperationId: operationId,
        workCenterId,
        type: "Machine",
        startTime: "2026-10-13T09:30:00.000Z",
        endTime: "2026-10-13T10:00:00.000Z",
        createdBy: "operator"
      });
      await insert("productionEvent", {
        id: id("second"),
        jobOperationId: operationId,
        workCenterId,
        type: "Machine",
        startTime: "2026-10-13T10:10:00.000Z",
        createdBy: "operator"
      });

      await sync(fakeProvider([]).provider);

      expect(await unattributedTime()).toEqual([
        {
          startTime: "2026-10-13T10:00:00.000Z",
          endTime: "2026-10-13T10:10:00.000Z"
        }
      ]);
      const marker = await client.query(
        `SELECT "unplannedPressAt" FROM "workCenterDevice" WHERE "id" = $1`,
        [deviceId]
      );
      expect(marker.rows[0]?.unplannedPressAt).toBeNull();
    });
  }
);
