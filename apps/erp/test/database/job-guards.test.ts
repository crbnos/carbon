// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. A published production operation must refuse
// what its route refused: an API or MCP caller reaches the function, not the
// route. Actors hold literal pages, so each refusal names the page it needs.

import {
  type Actor,
  createServiceContext
} from "@carbon/api/service-fn.server";
import type { Database } from "@carbon/database";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ExpandedClaims } from "@carbon/database/access";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { JOB_LOCKED_MESSAGE } from "../../app/modules/production/production.models";
import * as production from "../../app/modules/production/production.server";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";
import { pageClaims } from "../page-claims";

const client = hasLocalDatabase ? localServiceRoleClient() : null;

const SYSTEM: Actor = { type: "system", onBehalfOf: USER };

const every = () => {
  const all = [f.companyId];
  return { view: all, create: all, update: all, delete: all };
};

/** An employee holding every action on exactly `pages` in the company. */
function holding(...pages: string[]): Actor {
  return employee(Object.fromEntries(pages.map((page) => [page, every()])));
}

/** An employee holding every page of `module`, and nothing else. */
function holdingModule(module: string): Actor {
  return employee(pageClaims({ [module]: every() }));
}

function employee(permissions: ExpandedClaims): Actor {
  return { type: "user", role: "employee", userId: USER, permissions };
}

/** A caller whose every request fails: an operation must not read as it. */
const unreachableCaller = createClient<Database>(
  "http://localhost:1",
  "no-key",
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (async () => {
        throw new Error("The caller's client is not used");
      }) as typeof fetch
    }
  }
);

let f: Fixture;
let job: Awaited<ReturnType<typeof jobFixture>>;
let methodId = "";
let operationId = "";
let heldItemId = "";

function contextFor(
  actor: Actor = SYSTEM,
  caller: SupabaseClient<Database> = client!
) {
  return createServiceContext({
    actor,
    company: { id: f.companyId, groupId: f.groupId },
    caller,
    system: () => client!,
    pg: () => f.db,
    kv: () => {
      throw new Error("No operation here reads the cache");
    }
  });
}

beforeAll(async () => {
  if (!client) return;
  f = await alwaysPostFixture();
  job = await jobFixture(f);
  heldItemId = `${f.prefix}-held`;
  await seed(f, async (trx) => {
    // The assembly's revision is released and its method Active.
    await trx
      .updateTable("item")
      .set({ revisionStatus: "Production" })
      .where("id", "=", f.assemblyId)
      .execute();
    const method = await trx
      .updateTable("makeMethod")
      .set({ status: "Active" })
      .where("itemId", "=", f.assemblyId)
      .where("companyId", "=", f.companyId)
      .returning("id")
      .executeTakeFirstOrThrow();
    methodId = method.id;
    const process = await trx
      .selectFrom("process")
      .select("id")
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    const operation = await trx
      .insertInto("methodOperation")
      .values({
        makeMethodId: methodId,
        processId: process.id,
        description: "Assemble",
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    operationId = operation.id;
    await trx
      .insertInto("methodOperationStep")
      .values(
        [1, 2].map((sortOrder) => ({
          id: `${f.prefix}-step-${sortOrder}`,
          operationId,
          name: `Step ${sortOrder}`,
          type: "Task" as const,
          sortOrder,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();

    // An item a change notice still in progress created.
    await trx
      .insertInto("changeOrder")
      .values({
        id: `${f.prefix}-co`,
        changeOrderId: `${f.prefix}-CO`,
        name: "Open notice",
        status: "Start",
        openDate: "2026-01-01",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("item")
      .values({
        id: heldItemId,
        readableId: `${f.prefix}-HELD`,
        name: "Held part",
        type: "Part",
        itemTrackingType: "Inventory",
        replenishmentSystem: "Make",
        changeOrderId: `${f.prefix}-co`,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
}, 60_000);

afterAll(async () => {
  if (!client) return;
  await f.cleanup();
}, 60_000);

const stepOrders = async () =>
  (
    await f.db
      .selectFrom("methodOperationStep")
      .select(["id", "sortOrder"])
      .where("operationId", "=", operationId)
      .orderBy("id")
      .execute()
  ).map((row) => Number(row.sortOrder));

const jobsOfItem = async (itemId: string) =>
  (
    await f.db
      .selectFrom("job")
      .select("id")
      .where("itemId", "=", itemId)
      .where("companyId", "=", f.companyId)
      .execute()
  ).length;

describe("published production operations hold their routes' checks", () => {
  databaseTest(
    "runs MRP only with Edit on Material Planning, with the service role",
    async () => {
      const mrp = { type: "company", id: f.companyId } as const;
      const inventory = await production.runMRP(
        contextFor(holdingModule("inventory")),
        mrp
      );
      const planner = await production.runMRP(
        contextFor(holding("production.materialPlanning"), unreachableCaller),
        mrp
      );

      expect(inventory.error?.category).toBe("forbidden");
      expect(planner.error).toBeNull();
    }
  );

  databaseTest(
    "reorders a method's steps only with Edit on the item's page, on a Draft method",
    async () => {
      const updates = [
        { id: `${f.prefix}-step-1`, sortOrder: 2 },
        { id: `${f.prefix}-step-2`, sortOrder: 1 }
      ];
      const productionOnly = await production.updateMethodOperationStepOrder(
        contextFor(holdingModule("production")),
        { operationId, updates }
      );
      // The assembly is a Part: Edit on Parts passes the gate, and the
      // Active method is then refused by the Draft rule.
      const partsEditor = await production.updateMethodOperationStepOrder(
        contextFor(holding("parts.parts")),
        { operationId, updates }
      );

      expect(productionOnly.error?.category).toBe("forbidden");
      expect(partsEditor.error?.category).toBe("rule");
      expect(await stepOrders()).toEqual([1, 2]);
    }
  );

  databaseTest(
    "reorders a quote operation's steps only with Edit on Quotes and Jobs",
    async () => {
      const input = {
        operationId,
        updates: [{ id: `${f.prefix}-step-1`, sortOrder: 2 }]
      };
      const productionOnly = await production.updateQuoteOperationStepOrder(
        contextFor(holdingModule("production")),
        input
      );
      const quotesOnly = await production.updateQuoteOperationStepOrder(
        contextFor(holding("sales.quotes")),
        input
      );
      const both = await production.updateQuoteOperationStepOrder(
        contextFor(holding("sales.quotes", "production.jobs")),
        input
      );

      expect(productionOnly.error?.category).toBe("forbidden");
      expect(quotesOnly.error?.category).toBe("forbidden");
      // Past the gate, the reorder refuses a step that is on no quote operation.
      expect(both.error?.category).toBe("internal");
    }
  );

  databaseTest(
    "saves a job's method onto an item only with Edit on the item's page and Jobs, outside the revision lock",
    async () => {
      const input = { sourceId: job.jobId, targetId: methodId };
      const productionOnly = await production.upsertMakeMethodFromJob(
        contextFor(holdingModule("production")),
        input
      );
      const partsOnly = await production.upsertMakeMethodFromJob(
        contextFor(holding("parts.parts")),
        input
      );
      const released = await production.upsertMakeMethodFromJob(
        contextFor(holding("parts.parts", "production.jobs")),
        input
      );
      const subAssembly = await production.upsertMakeMethodFromJobMethod(
        contextFor(),
        input
      );

      expect(productionOnly.error?.category).toBe("forbidden");
      expect(partsOnly.error?.category).toBe("forbidden");
      expect(released.error?.category).toBe("rule");
      expect(subAssembly.error?.category).toBe("rule");
    }
  );

  databaseTest("creates a job only as Draft or Planned", async () => {
    const result = await production.insertJob(contextFor(), {
      itemId: f.assemblyId,
      quantity: 1,
      locationId: f.locationId,
      status: "Completed"
    } as never);
    expect(result.error?.category).toBe("validation");
    expect(await jobsOfItem(f.assemblyId)).toBe(1);
  });

  databaseTest("makes no job for an item an unreleased change notice holds", async () => {
    const ctx = contextFor();
    const single = await production.insertJob(ctx, {
      itemId: heldItemId,
      quantity: 1,
      locationId: f.locationId
    });
    const bulk = await production.createJobs(ctx, {
      itemId: heldItemId,
      totalQuantity: 2,
      quantityPerJob: 1,
      scrapQuantityPerJob: 0,
      unitOfMeasureCode: "EA",
      deadlineType: "No Deadline",
      locationId: f.locationId
    });
    const planned = await production.orderPlannedJobs(ctx, {
      locationId: f.locationId,
      items: [
        {
          id: heldItemId,
          orders: [
            {
              startDate: null,
              dueDate: null,
              periodId: "any",
              quantity: 1
            }
          ]
        }
      ]
    });

    expect(single.error?.category).toBe("rule");
    expect(bulk.error?.category).toBe("rule");
    expect(planned.error?.message).toContain(`${f.prefix}-CO`);
    expect(await jobsOfItem(heldItemId)).toBe(0);
  });

  databaseTest("converts no sales order line whose item an unreleased change notice holds", async () => {
    const salesOrderId = `${f.prefix}-so-held`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("salesOrder")
        .values({
          id: salesOrderId,
          salesOrderId: "SO-HELD",
          customerId: f.customerId,
          currencyCode: "USD",
          exchangeRate: 1,
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("salesOrderLine")
        .values({
          salesOrderId,
          salesOrderLineType: "Part",
          itemId: heldItemId,
          saleQuantity: 1,
          unitPrice: 25,
          methodType: "Make to Order",
          unitOfMeasureCode: "EA",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });

    const result = await production.convertSalesOrderLinesToJobs(
      contextFor(),
      { orderId: salesOrderId }
    );

    expect(result.error?.category).toBe("rule");
    expect(result.error?.message).toContain(`${f.prefix}-CO`);
    expect(await jobsOfItem(heldItemId)).toBe(0);
  });

  databaseTest("refuses a locked job's method writes", async () => {
    await seed(f, (trx) =>
      trx
        .updateTable("job")
        .set({ status: "Completed" })
        .where("id", "=", job.jobId)
        .execute()
    );
    const ctx = contextFor();
    const makeMethod = await f.db
      .selectFrom("jobMakeMethod")
      .select("id")
      .where("jobId", "=", job.jobId)
      .executeTakeFirstOrThrow();

    const results = await Promise.all([
      production.configureJob(ctx, { jobId: job.jobId, configuration: {} }),
      production.copyMethodToMaterial(ctx, {
        sourceId: f.assemblyId,
        targetId: makeMethod.id,
        parts: {
          billOfMaterial: true,
          billOfProcess: true,
          parameters: true,
          tools: true,
          steps: true,
          workInstructions: true
        }
      }),
      production.createJobMaterial(ctx, {
        id: `${f.prefix}-material-new`,
        jobId: job.jobId,
        jobMakeMethodId: makeMethod.id,
        itemId: f.partId,
        itemType: "Part",
        methodType: "Pull from Inventory",
        description: "Bracket",
        kit: false,
        order: 2,
        quantity: 1,
        requiresBatchTracking: false,
        requiresSerialTracking: false,
        unitCost: 0,
        unitOfMeasureCode: "EA"
      }),
      production.deleteJobMaterial(ctx, {
        jobId: job.jobId,
        id: job.materialId
      }),
      production.deleteJobOperation(ctx, {
        jobId: job.jobId,
        id: job.operationId
      }),
      production.reorderJobOperations(ctx, {
        jobId: job.jobId,
        orders: { [job.operationId]: 2 }
      }),
      production.syncJobOperationProcedure(ctx, {
        operationId: job.operationId,
        procedureId: "any"
      })
    ]);

    for (const result of results) {
      expect(result.error).toMatchObject({
        category: "rule",
        message: JOB_LOCKED_MESSAGE
      });
    }
    const [materials, operations] = await Promise.all([
      f.db
        .selectFrom("jobMaterial")
        .select("id")
        .where("jobId", "=", job.jobId)
        .execute(),
      f.db
        .selectFrom("jobOperation")
        .select("id")
        .where("jobId", "=", job.jobId)
        .execute()
    ]);
    expect(materials.map((row) => row.id)).toEqual([job.materialId]);
    expect(operations.map((row) => row.id)).toEqual([job.operationId]);
  });
});
