// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. A header change is checked against the jobs
// it changes: the customer's contact and asset, the customer of a job from a
// return or on an asset, and the location of a job with issued parts.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { describe, expect, it } from "vitest";
import { updateServiceJob } from "../../../app/modules/service/service.server";
import { hasLocalDatabase } from "../fixtures/local-database";
import { localServiceRoleClient } from "../fixtures/local-supabase";
import { PROJECT_TEST_USER } from "../fixtures/project-posting";
import { serviceJobFixture } from "../fixtures/service-job";

const client = hasLocalDatabase ? localServiceRoleClient() : null;

type Fixture = Awaited<ReturnType<typeof serviceJobFixture>>;

function contextFor(f: Fixture) {
  return createServiceContext({
    actor: { type: "system", onBehalfOf: PROJECT_TEST_USER },
    company: { id: f.companyId, groupId: f.groupId },
    caller: client!,
    system: () => client!,
    pg: () => f.db,
    kv: () => {
      throw new Error("A header update reads no cache");
    }
  });
}

describe.skipIf(!client)("updating a service job's header", () => {
  it("checks the customer's contact and asset, keeps a return's customer and an issued job's location", async () => {
    const f = await serviceJobFixture();
    try {
      const ctx = contextFor(f);
      const { locationId, itemId } = await f.addStockedItem("unit", {
        quantity: 1,
        unitCost: 10
      });
      const { locationId: otherLocationId } = await f.addStockedItem("spare", {
        quantity: 1,
        unitCost: 10
      });
      const otherCustomerId = `${f.prefix}-other-customer`;
      await f.db
        .insertInto("customer")
        .values({
          id: otherCustomerId,
          readableId: `${f.prefix}-C2`,
          name: "Other",
          companyId: f.companyId
        })
        .execute();
      const contact = await f.db
        .insertInto("contact")
        .values({ companyId: f.companyId })
        .returning("id")
        .executeTakeFirstOrThrow();
      const otherContact = await f.db
        .insertInto("customerContact")
        .values({
          customerId: otherCustomerId,
          contactId: contact.id,
          companyId: f.companyId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const serial = await f.db
        .insertInto("trackedEntity")
        .values({
          id: `${f.prefix}-sn`,
          readableId: "SN-1",
          itemId,
          quantity: 1,
          status: "Consumed",
          sourceDocument: "Item",
          sourceDocumentId: itemId,
          attributes: {},
          companyId: f.companyId,
          createdBy: PROJECT_TEST_USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const otherAsset = await f.db
        .insertInto("customerAsset")
        .values({
          customerId: otherCustomerId,
          itemId,
          trackedEntityId: serial.id,
          companyId: f.companyId,
          createdBy: PROJECT_TEST_USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const job = await f.addJob({ locationId });
      const update = (field: string, value: string | null) =>
        updateServiceJob(ctx, {
          ids: [job.id],
          field: field as "customerId",
          value
        });

      // Another customer's contact and asset are refused.
      const contactRefused = await update(
        "customerContactId",
        otherContact.id
      );
      expect(contactRefused.error).not.toBeNull();
      const assetRefused = await update("customerAssetId", otherAsset.id);
      expect(assetRefused.error?.message).toBe(
        "The asset belongs to another customer"
      );

      // No parts issued: the location changes.
      const moved = await update("locationId", otherLocationId);
      expect(moved.error).toBeNull();

      // A Part line pins the location.
      await f.db
        .insertInto("serviceJobItem")
        .values({
          serviceJobId: job.id,
          lineType: "Part",
          itemId,
          description: "Unit",
          quantity: 1,
          unitCost: 10,
          companyId: f.companyId,
          createdBy: PROJECT_TEST_USER
        })
        .execute();
      const pinned = await update("locationId", locationId);
      expect(pinned.error?.message).toBe(
        "Return the issued parts before changing the job's location."
      );

      // A job from a return keeps its customer.
      const { lineId } = await f.addReturnLine({ itemId });
      const fromReturn = await f.addJob({
        locationId,
        salesReturnOrderLineId: lineId
      });
      const customerRefused = await updateServiceJob(ctx, {
        ids: [fromReturn.id],
        field: "customerId",
        value: otherCustomerId
      });
      expect(customerRefused.error?.message).toBe(
        "A job from a return or on a customer asset keeps its customer."
      );
      const plain = await f.addJob({ locationId });
      const customerChanged = await updateServiceJob(ctx, {
        ids: [plain.id],
        field: "customerId",
        value: otherCustomerId
      });
      expect(customerChanged.error).toBeNull();
    } finally {
      await f.cleanup();
    }
  });
});
