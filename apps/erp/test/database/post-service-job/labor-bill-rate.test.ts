// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. A job's bill rate: a new job copies the
// company's default, a change sets the price of its Labor estimate lines, and
// the rate is locked once the estimate is sent.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { describe, expect, it } from "vitest";
import {
  createServiceJob,
  updateServiceJob
} from "../../../app/modules/service/service.server";
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
      throw new Error("A bill rate change reads no cache");
    }
  });
}

describe.skipIf(!client)("a service job's bill rate", () => {
  it("copies the company's bill rate into a new job", async () => {
    const f = await serviceJobFixture();
    try {
      const { locationId } = await f.addStockedItem("unit", {
        quantity: 1,
        unitCost: 10
      });
      // The scratch company has no job numbers yet.
      await f.db
        .insertInto("sequence")
        .values({
          table: "serviceJob",
          name: "Service Job",
          prefix: "SJ",
          companyId: f.companyId
        })
        .execute();
      const created = await createServiceJob(contextFor(f), {
        customerId: f.customerId,
        locationId,
        workSite: "Depot",
        billingMethod: "Time and Materials",
        priority: "Medium"
      });
      expect(created.error).toBeNull();

      const job = await f.db
        .selectFrom("serviceJob")
        .select("laborBillRate")
        .where("id", "=", created.data!.id)
        .executeTakeFirstOrThrow();
      expect(Number(job.laborBillRate)).toBe(95);
    } finally {
      await f.cleanup();
    }
  });

  it("sets the price of the job's Labor estimate lines when it changes", async () => {
    const f = await serviceJobFixture();
    try {
      const { locationId } = await f.addStockedItem("unit", {
        quantity: 1,
        unitCost: 10
      });
      const job = await f.addJob({ locationId });
      const line = await f.db
        .insertInto("serviceJobEstimateLine")
        .values({
          serviceJobId: job.id,
          itemId: null,
          description: "Labor",
          quantity: 2,
          unitPrice: 95,
          companyId: f.companyId,
          createdBy: PROJECT_TEST_USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const changed = await updateServiceJob(contextFor(f), {
        ids: [job.id],
        field: "laborBillRate",
        value: "110"
      });
      expect(changed.error).toBeNull();

      const saved = await f.db
        .selectFrom("serviceJob")
        .select("laborBillRate")
        .where("id", "=", job.id)
        .executeTakeFirstOrThrow();
      expect(Number(saved.laborBillRate)).toBe(110);
      const labor = await f.db
        .selectFrom("serviceJobEstimateLine")
        .select(["unitPrice", "quantity"])
        .where("id", "=", line.id)
        .executeTakeFirstOrThrow();
      expect(Number(labor.unitPrice)).toBe(110);
      expect(Number(labor.quantity) * Number(labor.unitPrice)).toBe(220);
    } finally {
      await f.cleanup();
    }
  });

  it("refuses a change after the estimate was sent", async () => {
    const f = await serviceJobFixture();
    try {
      const { locationId } = await f.addStockedItem("unit", {
        quantity: 1,
        unitCost: 10
      });
      const job = await f.addJob({ locationId, estimateStatus: "Sent" });

      const refused = await updateServiceJob(contextFor(f), {
        ids: [job.id],
        field: "laborBillRate",
        value: "110"
      });
      expect(refused.error?.message).toBe(
        "The bill rate is locked: the estimate was sent to the customer."
      );
    } finally {
      await f.cleanup();
    }
  });
});
