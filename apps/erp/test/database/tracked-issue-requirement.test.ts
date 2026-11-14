// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// The Issue dialog consumed a batch kit into a job again each time it was
// submitted: a job that needed one kit took three, and the kit rack lost two
// kits that never left it. An issue past the requirement is now refused until
// the operator confirms it.

import { afterAll, beforeAll, describe, expect } from "vitest";
import { issueMaterial as issue } from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";

describe.skipIf(!hasLocalDatabase)("tracked issue requirement", () => {
  let f: Fixture;
  let kitItemId: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    kitItemId = `${f.prefix}-kit`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("item")
        .values({
          id: kitItemId,
          readableId: `${f.prefix}-KIT`,
          name: "Station kit",
          type: "Part",
          itemTrackingType: "Batch",
          replenishmentSystem: "Make",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .updateTable("itemCost")
        .set({ costingMethod: "FIFO", unitCost: 10 })
        .where("itemId", "=", kitItemId)
        .where("companyId", "=", f.companyId)
        .execute();
    });
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  /** A job that needs one kit, the unit it builds, and a lot of five kits. */
  async function jobNeedingOneKit(key: string) {
    const job = await jobFixture(f, key);
    const makeMethod = await f.db
      .selectFrom("jobMakeMethod")
      .select("id")
      .where("jobId", "=", job.jobId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    const material = await f.db
      .insertInto("jobMaterial")
      .values({
        jobId: job.jobId,
        jobMakeMethodId: makeMethod.id,
        jobOperationId: job.operationId,
        itemId: kitItemId,
        itemType: "Part",
        methodType: "Pull from Inventory",
        description: "Station kit",
        quantity: 1,
        estimatedQuantity: 1,
        requiresBatchTracking: true,
        unitOfMeasureCode: "EA",
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const parentId = `${f.prefix}-unit-${key}`;
    const lotId = `${f.prefix}-lot-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("trackedEntity")
        .values([
          {
            id: parentId,
            quantity: 1,
            status: "Reserved",
            sourceDocument: "Item",
            sourceDocumentId: f.assemblyId,
            itemId: f.assemblyId,
            companyId: f.companyId,
            createdBy: USER
          },
          {
            id: lotId,
            readableId: `KIT-${key}`,
            quantity: 5,
            status: "Available",
            sourceDocument: "Item",
            sourceDocumentId: kitItemId,
            itemId: kitItemId,
            companyId: f.companyId,
            createdBy: USER
          }
        ])
        .execute();
      await trx
        .insertInto("itemLedger")
        .values({
          itemId: kitItemId,
          trackedEntityId: lotId,
          quantity: 5,
          locationId: f.locationId,
          entryType: "Positive Adjmt.",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });

    const issueKits = (quantity: number, allowOverIssue?: boolean) =>
      invokePosting(
        handlesOf(f.ctx),
        "issue",
        {
          type: "trackedEntitiesToOperation",
          materialId: material.id,
          parentTrackedEntityId: parentId,
          children: [{ trackedEntityId: lotId, quantity }],
          allowOverIssue
        },
        issue
      );

    /** Scraps the kit the job consumed, as the dialog's Scrap tab does. */
    const scrapIssuedKit = async (consumedKitId: string) => {
      const reason = await f.db
        .insertInto("scrapReason")
        .values({
          name: `Damaged ${key}`,
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return invokePosting(
        handlesOf(f.ctx),
        "issue",
        {
          type: "scrapTrackedEntity",
          trackedEntityId: consumedKitId,
          materialId: material.id,
          parentTrackedEntityId: parentId,
          scrapReasonId: reason.id
        },
        issue
      );
    };

    const state = async () => {
      const row = await f.db
        .selectFrom("jobMaterial")
        .select("quantityIssued")
        .where("id", "=", material.id)
        .executeTakeFirstOrThrow();
      const lot = await f.db
        .selectFrom("trackedEntity")
        .select("quantity")
        .where("id", "=", lotId)
        .executeTakeFirstOrThrow();
      return {
        issued: Number(row.quantityIssued),
        leftInLot: Number(lot.quantity)
      };
    };

    return { issueKits, scrapIssuedKit, state };
  }

  databaseTest(
    "a kit the job already has is not issued again from the Issue dialog",
    async () => {
      const job = await jobNeedingOneKit("again");

      expect((await job.issueKits(1)).error).toBeNull();
      const second = await job.issueKits(1);

      expect(second.error?.message).toBe(
        "This job already has all its Station kit"
      );
      expect(second.error).toMatchObject({ body: { overIssue: true } });
      expect(await job.state()).toEqual({ issued: 1, leftInLot: 4 });
    }
  );

  databaseTest(
    "an issue of more kits than the job still needs is refused whole",
    async () => {
      const job = await jobNeedingOneKit("many");

      const issued = await job.issueKits(3);

      expect(issued.error?.message).toBe(
        "This job needs only 1 more of Station kit"
      );
      expect(issued.error).toMatchObject({ body: { overIssue: true } });
      expect(await job.state()).toEqual({ issued: 0, leftInLot: 5 });
    }
  );

  databaseTest(
    "a replacement for a scrapped kit is issued without a confirmation",
    async () => {
      const job = await jobNeedingOneKit("scrapped");

      const first = await job.issueKits(1);
      expect(first.error).toBeNull();
      const consumedKitId = first.data?.splitEntities?.[0]?.newId;
      expect(consumedKitId).toBeDefined();
      expect((await job.scrapIssuedKit(consumedKitId as string)).error).toBeNull();

      expect((await job.issueKits(1)).error).toBeNull();
      expect(await job.state()).toEqual({ issued: 1, leftInLot: 3 });
    }
  );

  databaseTest(
    "a confirmed extra kit is issued past the requirement",
    async () => {
      const job = await jobNeedingOneKit("extra");

      expect((await job.issueKits(1)).error).toBeNull();
      expect((await job.issueKits(1, true)).error).toBeNull();

      expect(await job.state()).toEqual({ issued: 2, leftInLot: 3 });
    }
  );
});
