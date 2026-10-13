// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Field Service Phase C, decision C6: a serial with an open Refurbishment
// order is not picked.

import { sql } from "kysely";
import { expect } from "vitest";
import { projectPostingFixture } from "../lib/project-posting-test-fixture";
import { databaseTest } from "../local-database-test-fixture";
import postPicking from "./index";

databaseTest(
  "picking a serial under refurbishment is refused until its order is no longer open",
  async () => {
    const f = await projectPostingFixture();
    try {
      const id = (name: string) => `${f.prefix}-${name}`;
      const locationId = id("pick-location");
      const itemId = id("pick-serial-item");
      const serialId = id("pick-sn-0050");
      const projectId = id("pick-refurb-project");
      const serviceOrderId = id("pick-refurb-order");
      const pickingListId = id("pick-list");
      const pickingListLineId = id("pick-line");

      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("location")
          .values({
            id: locationId,
            name: "Plant",
            addressLine1: "1 Main St",
            city: "Springfield",
            postalCode: "00000",
            timezone: "America/New_York",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("item")
          .values({
            id: itemId,
            readableId: id("PICK-MACHINE"),
            name: "Machine",
            type: "Part",
            itemTrackingType: "Serial",
            replenishmentSystem: "Buy",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("trackedEntity")
          .values({
            id: serialId,
            readableId: "SN-0050",
            itemId,
            quantity: 1,
            status: "On Hold",
            sourceDocument: "Item",
            sourceDocumentId: itemId,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("itemLedger")
          .values({
            postingDate: "2026-01-01",
            entryType: "Positive Adjmt.",
            itemId,
            locationId,
            trackedEntityId: serialId,
            quantity: 1,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("project")
          .values({
            id: projectId,
            name: "Refurbish SN-0050",
            identifier: "SVC-R2",
            status: "Released",
            projectType: "Service",
            costTreatment: "By Coverage",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("serviceOrder")
          .values({
            id: serviceOrderId,
            serviceOrderId: "SVC-R2",
            type: "Refurbishment",
            status: "In Progress",
            trackedEntityId: serialId,
            itemId,
            customerId: null,
            locationId,
            projectId,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
      });

      const job = await f.addConsumeToProjectJob("pick", {
        locationId,
        materialItemId: itemId,
        quantityPerParent: 1,
        jobQuantity: 1,
        consumeToProject: false
      });
      await f.db
        .insertInto("pickingList")
        .values({
          id: pickingListId,
          pickingListId: id("PL"),
          locationId,
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      await f.db
        .insertInto("pickingListLine")
        .values({
          id: pickingListLineId,
          pickingListId,
          jobId: job.jobId,
          jobMaterialId: job.materialId,
          itemId,
          quantityToPick: 1,
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();

      const pick = () =>
        postPicking(f.ctx, {
          type: "serial",
          pickingListId,
          pickingListLineId,
          trackedEntityId: serialId,
          fromStorageUnitId: null,
          locationId
        });

      const refused = await pick();
      expect(refused.error?.status).toEqual(422);
      expect(refused.error?.message).toEqual(
        "Serial SN-0050 is under refurbishment on SVC-R2. Complete the order first."
      );
      const untouched = await f.db
        .selectFrom("pickingListLine")
        .select("quantityPicked")
        .where("id", "=", pickingListLineId)
        .executeTakeFirstOrThrow();
      expect(Number(untouched.quantityPicked)).toEqual(0);

      // A cancelled order holds nothing back.
      await f.db
        .updateTable("serviceOrder")
        .set({ status: "Cancelled" })
        .where("id", "=", serviceOrderId)
        .where("companyId", "=", f.companyId)
        .execute();
      const picked = await pick();
      expect(picked.error).toBeNull();
      const line = await f.db
        .selectFrom("pickingListLine")
        .select("quantityPicked")
        .where("id", "=", pickingListLineId)
        .executeTakeFirstOrThrow();
      expect(Number(line.quantityPicked)).toEqual(1);
    } finally {
      // The company delete reaches trackedEntity before this table's rows.
      await f.db
        .deleteFrom("pickingListLineTrackedEntity")
        .where("companyId", "=", f.companyId)
        .execute();
      await f.cleanup();
    }
  }
);
