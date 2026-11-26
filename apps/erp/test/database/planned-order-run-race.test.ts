// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// An MRP run reads the planned orders first and writes its plan later. A
// person who firms or converts a planned order in between must win: the
// run's write sees the change under the planning lock and plans again, and
// never overwrites it (a converted week planned again is a second Make).
// The run and the person are on two connections, as they are in production.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { lockCompanyPlanning } from "@carbon/database/planning-lock";
import { afterEach, beforeEach, describe, expect } from "vitest";
import {
  PlannedOrdersChangedError,
  type PlannedOrderSnapshot,
  readPlannedOrderSnapshot,
  retryOnPlannedOrderChange,
  writePlannedOrderDiff
} from "../../../../packages/planning/src/mrp/planned-order-write";
import {
  type GeneratedPlannedOrder,
  plannedOrderNaturalKey
} from "../../../../packages/planning/src/mrp/planned-orders";
import { writePlanningActions } from "../../../../packages/planning/src/mrp/planning-action-write";
import { firmPlannedOrder } from "../../app/modules/production/production.server";
import { convertPlannedOrdersForActions } from "../../app/modules/production/production.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { systemServiceOf } from "./fixtures/handles";
import {
  connectLocalTestDatabase,
  databaseTest,
  hasLocalDatabase
} from "./fixtures/local-database";
import { backendPid, waitUntilBlocked } from "./fixtures/row-lock-race";

let f: Fixture;
let week: string;
/** The person's connection: their firm or convert commits on it. */
let person: Kysely<KyselyDatabase>;
let monitor: Kysely<KyselyDatabase>;

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A Planned Make order of 10, split 0 of the test's week. */
async function plannedOrder(): Promise<string> {
  const id = `${f.prefix}-planned`;
  await seed(f, (trx) =>
    trx
      .insertInto("plannedOrder")
      .values({
        id,
        companyId: f.companyId,
        itemId: f.partId,
        locationId: f.locationId,
        planningSegmentId: "",
        orderType: "Make",
        status: "Planned",
        quantity: 10,
        dueDate: "2298-01-05",
        releaseDate: "2298-01-01",
        periodId: week,
        splitIndex: 0,
        createdBy: USER
      })
      .execute()
  );
  return id;
}

async function job(): Promise<string> {
  const id = `${f.prefix}-job`;
  await seed(f, (trx) =>
    trx
      .insertInto("job")
      .values({
        id,
        jobId: "J-RACE",
        itemId: f.partId,
        quantity: 10,
        status: "Planned",
        unitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute()
  );
  return id;
}

/** What the run planned from its read: the same order, now 12. */
function replanned(): GeneratedPlannedOrder {
  const key = {
    itemId: f.partId,
    locationId: f.locationId,
    planningSegmentId: "",
    orderType: "Make" as const,
    periodId: week,
    splitIndex: 0
  };
  return {
    ...key,
    naturalKey: plannedOrderNaturalKey(key),
    quantity: 12,
    scrapQuantity: 0,
    dueDate: "2298-01-05",
    releaseDate: "2298-01-01",
    lowLevelCode: 0,
    supplierId: null,
    quantityTrace: {
      policyName: null,
      triggerValues: null,
      quantity: 12,
      scrapQuantity: 0,
      explosionQuantity: 12
    }
  };
}

/** The run's Phase-7 planned-order write, on the run's connection. */
function runWrite(args: {
  generated: GeneratedPlannedOrder[];
  heldPlannedOrderIds: string[];
  snapshot: PlannedOrderSnapshot;
}) {
  return f.db.transaction().execute(async (trx) => {
    await writePlannedOrderDiff(trx, {
      companyId: f.companyId,
      userId: USER,
      locationIds: [f.locationId],
      updatedAt: "2298-01-01T00:00:00Z",
      ...args
    });
    return readPlannedOrderSnapshot(trx, f.companyId);
  });
}

/** The company's planned orders, with the fields a person's change sets. */
async function plannedOrders() {
  const rows = await f.db
    .selectFrom("plannedOrder")
    .select(["id", "status", "quantity", "firmedBy", "jobId"])
    .where("companyId", "=", f.companyId)
    .orderBy("id")
    .execute();
  return rows.map((row) => ({ ...row, quantity: Number(row.quantity) }));
}

describe.skipIf(!hasLocalDatabase)("an MRP run racing a person", () => {
  beforeEach(async () => {
    f = await alwaysPostFixture();
    person = await connectLocalTestDatabase();
    monitor = await connectLocalTestDatabase();
    week = `${f.prefix}-week`;
    // `period` has no company: the test's own week, removed after.
    await seed(f, (trx) =>
      trx
        .insertInto("period")
        .values({
          id: week,
          startDate: "2298-01-01",
          endDate: "2298-01-07",
          periodType: "Week"
        })
        .execute()
    );
  });

  afterEach(async () => {
    await person?.destroy();
    await monitor?.destroy();
    // the planned orders go with the period (ON DELETE CASCADE)
    await f.db.deleteFrom("period").where("id", "=", week).execute();
    await f.cleanup();
  });

  databaseTest(
    "a firm committed after the run's read makes the run plan again, and the firm stands",
    async () => {
      const id = await plannedOrder();
      // The person's firm, on their own connection. Its re-plan fails at its
      // first read (no Supabase client), which never fails the firm.
      const personService = systemServiceOf(
        { db: person, companyId: f.companyId, userId: USER },
        f.service.company.groupId
      );

      const attempts: number[] = [];
      await retryOnPlannedOrderChange(async (attempt) => {
        attempts.push(attempt);
        const snapshot = await readPlannedOrderSnapshot(f.db, f.companyId);
        if (attempt === 1) {
          const firmed = await firmPlannedOrder(personService, {
            id,
            locationId: f.locationId
          });
          expect(firmed.error).toBeNull();
          // planned from the first read: the order is still the run's
          return runWrite({
            generated: [replanned()],
            heldPlannedOrderIds: [],
            snapshot
          });
        }
        // planned again from the second read: the Firm order is held
        return runWrite({ generated: [], heldPlannedOrderIds: [id], snapshot });
      });

      expect(attempts).toEqual([1, 2]);
      expect(await plannedOrders()).toEqual([
        { id, status: "Firm", quantity: 10, firmedBy: USER, jobId: null }
      ]);
    }
  );

  databaseTest(
    "a convert holding the planning lock when the run writes is seen by the write, which writes nothing",
    async () => {
      const id = await plannedOrder();
      const jobId = await job();
      const snapshot = await readPlannedOrderSnapshot(f.db, f.companyId);

      const runPid = await backendPid(f.db);
      const personPid = await backendPid(person);
      const held = signal();
      const release = signal();
      // The convert as `settleNewSupplyPlanningActions` runs it: the planning
      // lock first, then the convert, in one transaction, still open while
      // the run's write starts.
      const converting = person.transaction().execute(async (trx) => {
        await lockCompanyPlanning(trx, f.companyId);
        await convertPlannedOrdersForActions(trx, {
          companyId: f.companyId,
          userId: USER,
          documents: [
            {
              documentId: jobId,
              quantity: 10,
              plannedOrderId: id,
              itemId: f.partId,
              locationId: f.locationId,
              planningSegmentId: "",
              periodId: week,
              orderType: "Make"
            }
          ]
        });
        held.resolve();
        await release.promise;
      });
      void converting.catch(() => {});
      let writing: Promise<unknown> | undefined;
      try {
        await Promise.race([held.promise, converting]);
        let done = false;
        writing = runWrite({
          generated: [replanned()],
          heldPlannedOrderIds: [],
          snapshot
        }).finally(() => {
          done = true;
        });
        void writing.catch(() => {});
        await waitUntilBlocked(monitor, personPid, runPid, () => done);
        expect(done).toBe(false);
      } finally {
        release.resolve();
        await converting;
      }

      // Without the check under the lock the write would insert a second
      // Planned Make on the converted order's week.
      await expect(writing).rejects.toBeInstanceOf(PlannedOrdersChangedError);
      expect(await plannedOrders()).toEqual([
        { id, status: "Converted", quantity: 10, firmedBy: null, jobId }
      ]);
    }
  );

  databaseTest(
    "a firm committed after the run's planned-order write stops the worklist write",
    async () => {
      const id = await plannedOrder();
      const committed = await runWrite({
        generated: [replanned()],
        heldPlannedOrderIds: [],
        snapshot: await readPlannedOrderSnapshot(f.db, f.companyId)
      });
      const firmed = await firmPlannedOrder(
        systemServiceOf(
          { db: person, companyId: f.companyId, userId: USER },
          f.service.company.groupId
        ),
        { id, locationId: f.locationId }
      );
      expect(firmed.error).toBeNull();

      await expect(
        writePlanningActions(f.db, {
          companyId: f.companyId,
          userId: USER,
          candidates: [],
          periods: [],
          toleranceDays: 7,
          plannedOrderSnapshot: committed
        })
      ).rejects.toBeInstanceOf(PlannedOrdersChangedError);
      expect(await plannedOrders()).toEqual([
        { id, status: "Firm", quantity: 12, firmedBy: USER, jobId: null }
      ]);
    }
  );
});
