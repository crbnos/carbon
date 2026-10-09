// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { databaseTest, hasLocalDatabase } from "../local-database-test-fixture";
import {
  PROJECT_TEST_USER,
  projectPostingFixture
} from "./project-posting-test-fixture";
import { ensureCustomerAsset, insertServiceOrder } from "./service-orders";

type Fixture = Awaited<ReturnType<typeof projectPostingFixture>>;
type Service = Awaited<ReturnType<Fixture["addServiceOrder"]>>;

describe.skipIf(!hasLocalDatabase)("insertServiceOrder", () => {
  let f: Fixture;
  let service: Service;

  beforeAll(async () => {
    f = await projectPostingFixture();
    // The fixture's own order owns its project and is open on the subject
    // serial; close it so the serial can take a new order.
    service = await f.addServiceOrder("orders");
    await f.db.transaction().execute(async (trx) => {
      await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
      await trx
        .updateTable("serviceOrder")
        .set({ status: "Closed" })
        .where("id", "=", service.serviceOrderId)
        .where("companyId", "=", f.companyId)
        .execute();
      await trx
        .insertInto("sequence")
        .values({
          table: "serviceOrder",
          name: "Service Order",
          prefix: "SVC",
          size: 6,
          next: 0,
          step: 1,
          companyId: f.companyId
        })
        .execute();
    });
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  const args = () => ({
    companyId: f.companyId,
    userId: PROJECT_TEST_USER,
    type: "Field Visit" as const,
    trackedEntityId: service.subjectSerialId,
    serial: "SN-orders",
    itemId: service.subjectItemId,
    customerAssetId: service.customerAssetId,
    customerId: service.customerId,
    customerName: "Customer orders",
    customerLocationId: null,
    locationId: service.locationId,
    customerContractId: null,
    contractProjectId: null
  });

  databaseTest(
    "creates the order, its Service project and 6 states in one transaction",
    async () => {
      const created = await f.db
        .transaction()
        .execute((trx) => insertServiceOrder(trx, args()));

      const order = await f.db
        .selectFrom("serviceOrder")
        .select(["serviceOrderId", "status", "projectId", "type"])
        .where("id", "=", created.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(order).toEqual({
        serviceOrderId: created.serviceOrderId,
        status: "Draft",
        projectId: created.projectId,
        type: "Field Visit"
      });
      expect(created.serviceOrderId).toMatch(/^SVC\d+$/);

      const project = await f.db
        .selectFrom("project")
        .select(["identifier", "projectType", "status", "costTreatment"])
        .where("id", "=", created.projectId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(project).toEqual({
        identifier: created.serviceOrderId,
        projectType: "Service",
        status: "Released",
        costTreatment: "By Coverage"
      });

      const states = await f.db
        .selectFrom("projectState")
        .select("name")
        .where("projectId", "=", created.projectId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(states).toHaveLength(6);

      // Leave the serial free for the next case.
      await f.db
        .updateTable("serviceOrder")
        .set({ status: "Closed" })
        .where("id", "=", created.id)
        .where("companyId", "=", f.companyId)
        .execute();
    }
  );

  databaseTest(
    "a forced error rolls back the order, project and states",
    async () => {
      const counts = async () => {
        const [orders, projects, states] = await Promise.all([
          f.db
            .selectFrom("serviceOrder")
            .select(({ fn }) => fn.countAll<string>().as("n"))
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow(),
          f.db
            .selectFrom("project")
            .select(({ fn }) => fn.countAll<string>().as("n"))
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow(),
          f.db
            .selectFrom("projectState")
            .select(({ fn }) => fn.countAll<string>().as("n"))
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow()
        ]);
        return [orders.n, projects.n, states.n].map(Number);
      };
      const before = await counts();

      let createdId: string | null = null;
      await expect(
        f.db.transaction().execute(async (trx) => {
          const created = await insertServiceOrder(trx, args());
          createdId = created.id;
          throw new Error("forced");
        })
      ).rejects.toThrow("forced");

      expect(createdId).not.toBeNull();
      expect(await counts()).toEqual(before);
    }
  );

  databaseTest(
    "ensureCustomerAsset returns the existing asset, else creates a Manual one",
    async () => {
      const existing = await f.db.transaction().execute((trx) =>
        ensureCustomerAsset(trx, {
          companyId: f.companyId,
          userId: PROJECT_TEST_USER,
          trackedEntityId: service.subjectSerialId,
          customerId: service.customerId,
          customerLocationId: null
        })
      );
      expect(existing).toBe(service.customerAssetId);

      const serialId = `${f.prefix}-serial-unregistered`;
      await f.db
        .insertInto("trackedEntity")
        .values({
          id: serialId,
          readableId: "SN-UNREGISTERED",
          itemId: service.subjectItemId,
          quantity: 1,
          status: "Consumed",
          sourceDocument: "Item",
          sourceDocumentId: service.subjectItemId,
          companyId: f.companyId,
          createdBy: PROJECT_TEST_USER
        })
        .execute();
      const created = await f.db.transaction().execute((trx) =>
        ensureCustomerAsset(trx, {
          companyId: f.companyId,
          userId: PROJECT_TEST_USER,
          trackedEntityId: serialId,
          customerId: service.customerId,
          customerLocationId: null
        })
      );
      const asset = await f.db
        .selectFrom("customerAsset")
        .select(["itemId", "customerId", "source", "status"])
        .where("id", "=", created)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(asset).toEqual({
        itemId: service.subjectItemId,
        customerId: service.customerId,
        source: "Manual",
        status: "In Service"
      });
    }
  );
});
