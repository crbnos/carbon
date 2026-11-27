// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The planned-order write against a live local database: a run whose write
// phase fails after the planned orders leaves the previous planned orders as
// they were. Skipped without a local SUPABASE_DB_URL.

import {
  type DB,
  getPostgresClient,
  getProcessPool
} from "@carbon/database/client";
import { type Kysely, PostgresDriver, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertPlannedOrdersUnchanged,
  PlannedOrdersChangedError,
  readPlannedOrderSnapshot,
  writePlannedOrderDiff
} from "./planned-order-write";
import {
  type GeneratedPlannedOrder,
  plannedOrderNaturalKey
} from "./planned-orders";

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

const USER = "system";

describe.skipIf(!hasLocalDatabase)(
  "writePlannedOrderDiff in a failed run",
  () => {
    let db: Kysely<DB>;
    const prefix = `plowrite-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const companyId = `${prefix}-company`;
    const itemId = `${prefix}-item`;
    const locationId = `${prefix}-location`;

    /** A planned order of the test's company; foreign keys are off for it. */
    const row = (
      key: string,
      splitIndex: number,
      status: "Planned" | "Firm"
    ) => ({
      id: `${prefix}-${key}`,
      companyId,
      itemId,
      locationId,
      planningSegmentId: "",
      orderType: "Make" as const,
      status,
      firmedBy: status === "Firm" ? USER : null,
      firmedAt: status === "Firm" ? "2295-01-01T00:00:00Z" : null,
      quantity: 10,
      scrapQuantity: 0,
      dueDate: "2295-01-08",
      releaseDate: "2295-01-01",
      periodId: `${prefix}-week`,
      splitIndex,
      lowLevelCode: 0,
      createdBy: USER
    });
    const seeded = [
      row("kept", 0, "Planned"),
      row("unmatched", 1, "Planned"),
      row("firm", 2, "Firm")
    ];

    const generated = (
      splitIndex: number,
      quantity: number
    ): GeneratedPlannedOrder => {
      const order = {
        itemId,
        locationId,
        planningSegmentId: "",
        orderType: "Make" as const,
        quantity,
        scrapQuantity: 0,
        dueDate: "2295-01-08",
        releaseDate: "2295-01-01",
        periodId: `${prefix}-week`,
        splitIndex,
        lowLevelCode: 0,
        supplierId: null,
        quantityTrace: {
          policyName: "Demand-Based Reorder",
          triggerValues: null,
          quantity,
          scrapQuantity: 0,
          explosionQuantity: quantity
        }
      };
      return { ...order, naturalKey: plannedOrderNaturalKey(order) };
    };

    const stored = () =>
      db
        .selectFrom("plannedOrder")
        .select(["id", "status", "quantity", "splitIndex"])
        .where("companyId", "=", companyId)
        .orderBy("splitIndex")
        .execute();

    beforeAll(async () => {
      db = getPostgresClient<DB>(getProcessPool(), PostgresDriver);
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx.insertInto("plannedOrder").values(seeded).execute();
      });
    });

    afterAll(async () => {
      if (!db) return;
      await db
        .deleteFrom("plannedOrder")
        .where("companyId", "=", companyId)
        .execute();
      await db.destroy();
    });

    // The Phase 7 transaction writes the planned orders first, then the
    // forecasts; a forecast row with no location (23502) fails the whole run.
    it("leaves the previous planned orders unchanged when a later statement fails", async () => {
      const before = await stored();
      expect(before).toEqual([
        {
          id: `${prefix}-kept`,
          status: "Planned",
          quantity: 10,
          splitIndex: 0
        },
        {
          id: `${prefix}-unmatched`,
          status: "Planned",
          quantity: 10,
          splitIndex: 1
        },
        { id: `${prefix}-firm`, status: "Firm", quantity: 10, splitIndex: 2 }
      ]);

      const run = db.transaction().execute(async (trx) => {
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await writePlannedOrderDiff(trx, {
          companyId,
          userId: USER,
          locationIds: [locationId],
          generated: [generated(0, 15), generated(3, 4)],
          heldPlannedOrderIds: [],
          updatedAt: "2295-01-01T00:00:00Z"
        });
        // the write happened: an update, a delete and an insert
        expect(
          (
            await trx
              .selectFrom("plannedOrder")
              .select(["status", "quantity", "splitIndex"])
              .where("companyId", "=", companyId)
              .orderBy("splitIndex")
              .execute()
          ).map((r) => [r.splitIndex, r.status, r.quantity])
        ).toEqual([
          [0, "Planned", 15],
          [2, "Firm", 10],
          [3, "Planned", 4]
        ]);
        await trx
          .insertInto("demandForecast")
          .values({
            companyId,
            itemId,
            locationId: null as unknown as string,
            periodId: `${prefix}-week`,
            forecastQuantity: 1,
            forecastMethod: "mrp",
            createdBy: USER,
            updatedBy: USER
          })
          .execute();
      });

      await expect(run).rejects.toMatchObject({ code: "23502" });
      expect(await stored()).toEqual(before);
    });

    // The worklist write checks the planned orders against what the run's
    // Phase-7 write committed: its own update, insert and delete are no
    // change, a person's Cancel after the commit is.
    it("reads a post-write snapshot that sees the run's own write as unchanged", async () => {
      const snapshot = await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await writePlannedOrderDiff(trx, {
          companyId,
          userId: USER,
          locationIds: [locationId],
          generated: [generated(0, 15), generated(3, 4)],
          heldPlannedOrderIds: [],
          updatedAt: "2295-01-01T00:00:00Z"
        });
        return readPlannedOrderSnapshot(trx, companyId);
      });
      expect(snapshot.rows.map((row) => row.status).sort()).toEqual([
        "Firm",
        "Planned",
        "Planned"
      ]);

      const check = () =>
        db
          .transaction()
          .execute((trx) =>
            assertPlannedOrdersUnchanged(trx, companyId, snapshot)
          );
      await expect(check()).resolves.toBeUndefined();

      await db
        .deleteFrom("plannedOrder")
        .where("companyId", "=", companyId)
        .where("id", "=", `${prefix}-kept`)
        .execute();
      await expect(check()).rejects.toBeInstanceOf(PlannedOrdersChangedError);
    });
  }
);
