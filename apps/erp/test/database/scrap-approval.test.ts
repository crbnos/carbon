// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. Scrap approval: the estimate a scrap rule is
// matched against, who may sign it, the record written before the posting,
// and the ERP's job quantity entry, which only an approver may use.

import { createHash } from "node:crypto";
import {
  type Actor,
  createServiceContext
} from "@carbon/api/service-fn.server";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  alwaysPostFixture,
  draftReceiptFromPurchaseOrder,
  type Fixture,
  jobFixture,
  seed,
  stockPart,
  USER
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { hasLocalDatabase } from "./fixtures/local-database";
import {
  localApiKeyClient,
  localServiceRoleClient
} from "./fixtures/local-supabase";

// Approval rules are a commercial feature, off in the community edition that
// an unset CARBON_EDITION reads as. Set before @carbon/env is imported.
vi.hoisted(() => {
  process.env.CARBON_EDITION = "enterprise";
});

const scrapApproval = await import("@carbon/ee/approvals/scrap.server");
const { createProductionQuantity, updateProductionQuantity } = await import(
  "../../app/modules/production/production.server"
);
const { adjustInventory } = await import(
  "../../app/modules/inventory/inventory.server"
);
const { postReceipt } = await import(
  "../../app/modules/inventory/inventory.service"
);
const { completeIssue, partialInspection, rejectInspection } = await import(
  "../../app/modules/quality/quality.server"
);
const { invokePosting } = await import(
  "../../app/modules/shared/shared.service"
);

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const describeLocal = describe.skipIf(!client);

let f: Fixture;
let job: Awaited<ReturnType<typeof jobFixture>>;
let people: { approver: string; operator: string };
/** Reaches PostgREST with an API key, as any integration can. */
let keyClient: SupabaseClient<Database>;

function modulePermissions() {
  const all = [f.companyId];
  const access = { view: all, create: all, update: all, delete: all };
  return {
    production: access,
    inventory: access,
    quality: access,
    accounting: access
  };
}

function userActor(userId: string): Actor {
  return { type: "user", userId, permissions: modulePermissions() };
}

function apiKeyActor(): Actor {
  return { type: "apiKey", createdBy: USER, scopes: modulePermissions() };
}

function contextFor(actor: Actor, caller: SupabaseClient<Database> = client!) {
  return createServiceContext({
    actor,
    company: { id: f.companyId, groupId: f.groupId },
    caller,
    system: () => client!,
    pg: () => f.db,
    kv: () => {
      throw new Error("Scrap approval reads no cache");
    }
  });
}

/** Replaces the company's scrap rules with tiers from these floors. */
async function scrapRules(...floors: number[]) {
  await f.db
    .deleteFrom("approvalRule")
    .where("companyId", "=", f.companyId)
    .where("documentType", "=", "scrap")
    .execute();
  if (floors.length === 0) return;
  await f.db
    .insertInto("approvalRule")
    .values(
      floors.map((lowerBoundAmount) => ({
        documentType: "scrap" as const,
        lowerBoundAmount,
        approverGroupIds: [people.approver, people.operator],
        enabled: true,
        companyId: f.companyId,
        createdBy: USER
      }))
    )
    .execute();
}

const scrapOf = (quantity: number) =>
  scrapApproval.describeScrap(f.db, f.companyId, {
    type: "operation",
    jobOperationId: job.operationId,
    quantity
  });

/** Only `people.approver` may sign; every tier floor given applies to them. */
async function approverOnlyRules(...floors: number[]) {
  await scrapRules(...floors);
  await f.db
    .updateTable("approvalRule")
    .set({ approverGroupIds: [people.approver] })
    .where("companyId", "=", f.companyId)
    .where("documentType", "=", "scrap")
    .execute();
}

async function newScrapReason(name: string) {
  const reason = await f.db
    .insertInto("scrapReason")
    .values({
      name: `${f.prefix} ${name}`,
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return reason.id;
}

async function scrappedOnOperation() {
  const operation = await f.db
    .selectFrom("jobOperation")
    .select("quantityScrapped")
    .where("id", "=", job.operationId)
    .executeTakeFirstOrThrow();
  return Number(operation.quantityScrapped);
}

beforeAll(async () => {
  if (!client) return;
  f = await alwaysPostFixture();
  job = await jobFixture(f);
  people = {
    approver: `${f.prefix}-approver`,
    operator: `${f.prefix}-operator`
  };
  const employeeType = `${f.prefix}-type`;
  await f.db.transaction().execute(async (trx) => {
    // No triggers: the employee type would want the groups a seed makes.
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    await trx
      .insertInto("user")
      .values([
        {
          id: people.approver,
          email: `${f.prefix}-approver@carbon.ms`,
          firstName: "Sam",
          lastName: "Approver"
        },
        {
          id: people.operator,
          email: `${f.prefix}-operator@carbon.ms`,
          firstName: "Olu",
          lastName: "Operator"
        }
      ])
      .execute();
    await trx
      .insertInto("employeeType")
      .values({ id: employeeType, name: f.prefix, companyId: f.companyId })
      .execute();
    await trx
      .insertInto("employee")
      .values(
        [people.approver, people.operator].map((id) => ({
          id,
          companyId: f.companyId,
          employeeTypeId: employeeType,
          active: true
        }))
      )
      .execute();
  });
  // Both have a console PIN; the operator is in the approver list too, as an
  // operator who is also a lead would be.
  for (const [employeeId, pin] of [
    [people.approver, "4321"],
    [people.operator, "1234"]
  ] as const) {
    await sql`SELECT set_employee_pin(${employeeId}, ${f.companyId}, ${pin}, ${USER})`.execute(
      f.db
    );
  }
  const rawKey = `crbn_test_${f.prefix}`;
  const all = [f.companyId];
  await f.db
    .insertInto("apiKey")
    .values({
      name: `${f.prefix} key`,
      companyId: f.companyId,
      createdBy: USER,
      keyHash: createHash("sha256").update(rawKey).digest("hex"),
      scopes: JSON.stringify({
        production_view: all,
        production_create: all,
        production_update: all,
        production_delete: all
      }),
      expiresAt: null
    })
    .execute();
  keyClient = localApiKeyClient(rawKey)!;
});

afterAll(async () => {
  if (!client || !f) return;
  await f.db
    .deleteFrom("approvalRequest")
    .where("companyId", "=", f.companyId)
    .execute();
  await f.cleanup();
  await client
    .from("user")
    .delete()
    .in("id", [people.approver, people.operator]);
});

describeLocal("scrap approval", () => {
  it("has no rule to meet until one is enabled", async () => {
    await scrapRules();
    expect(
      await scrapApproval.hasScrapApprovalRules(client!, f.companyId)
    ).toBe(false);
    await scrapRules(0);
    expect(
      await scrapApproval.hasScrapApprovalRules(client!, f.companyId)
    ).toBe(true);
  });

  it("values operation scrap at the material it writes off", async () => {
    // Two parts per unit at a unit cost of 10.
    const scrap = await scrapOf(3);
    expect(scrap).toMatchObject({
      jobId: job.jobId,
      jobOperationId: job.operationId,
      itemId: f.assemblyId,
      quantity: 3,
      estimatedValue: 60
    });
  });

  it("asks only scrap at or above the lowest tier for an approver", async () => {
    await scrapRules(100);
    const under = await scrapApproval.getScrapApprovalRequirement(
      client!,
      f.db,
      { companyId: f.companyId, recordedBy: USER, estimatedValue: 60 }
    );
    expect(under.required).toBe(false);

    const over = await scrapApproval.getScrapApprovalRequirement(
      client!,
      f.db,
      { companyId: f.companyId, recordedBy: USER, estimatedValue: 120 }
    );
    expect(over.required).toBe(true);
  });

  it("offers the approvers with a PIN, never the person scrapping", async () => {
    await scrapRules(0);
    const requirement = await scrapApproval.getScrapApprovalRequirement(
      client!,
      f.db,
      {
        companyId: f.companyId,
        recordedBy: people.operator,
        estimatedValue: 60
      }
    );
    expect(requirement.required).toBe(true);
    if (!requirement.required) return;
    expect(requirement.approvers.map((a) => a.id)).toEqual([people.approver]);
    expect(requirement.currencyCode).toBe("USD");
    expect(requirement.decimalPlaces).toBe(2);
  });

  it("refuses the recorder and a person outside the rule", async () => {
    await scrapRules(0);
    const self = await scrapApproval.authorizeScrapApprover(client!, {
      companyId: f.companyId,
      approverId: people.operator,
      recordedBy: people.operator,
      estimatedValue: 60
    });
    expect(self.error?.code).toBe("self");

    const outsider = await scrapApproval.authorizeScrapApprover(client!, {
      companyId: f.companyId,
      approverId: USER,
      recordedBy: people.operator,
      estimatedValue: 60
    });
    expect(outsider.error?.code).toBe("forbidden");

    const approver = await scrapApproval.authorizeScrapApprover(client!, {
      companyId: f.companyId,
      approverId: people.approver,
      recordedBy: people.operator,
      estimatedValue: 60
    });
    expect(approver.error).toBeNull();
  });

  it("records the approval before the posting and marks it posted", async () => {
    const scrap = await scrapOf(2);
    const recorded = await scrapApproval.recordScrapApproval(f.db, {
      companyId: f.companyId,
      scrap,
      recordedBy: people.operator,
      approvedBy: people.approver
    });

    const request = await f.db
      .selectFrom("approvalRequest")
      .select(["status", "amount", "requestedBy", "decisionBy", "documentId"])
      .where("id", "=", recorded.approvalRequestId)
      .executeTakeFirstOrThrow();
    expect(request).toMatchObject({
      status: "Approved",
      amount: 40,
      requestedBy: people.operator,
      decisionBy: people.approver,
      documentId: recorded.scrapRequestId
    });

    // The approvals view names the job and the item.
    const view = await client!
      .from("approvalRequests")
      .select("documentReadableId, documentDescription")
      .eq("id", recorded.approvalRequestId)
      .single();
    expect(view.data).toEqual({
      documentReadableId: "J-1",
      documentDescription: `${f.prefix}-ASSY`
    });

    // Listed before it posted, as not confirmed.
    const before = await scrapApproval.getScrapApprovals(client!, f.companyId, {
      limit: 10,
      offset: 0
    });
    expect(
      before.data?.find((row) => row.id === recorded.scrapRequestId)?.postedAt
    ).toBeNull();

    await scrapApproval.markScrapApprovalPosted(f.db, {
      companyId: f.companyId,
      scrapRequestIds: [recorded.scrapRequestId],
      userId: people.operator
    });
    const after = await scrapApproval.getScrapApprovals(client!, f.companyId, {
      limit: 10,
      offset: 0
    });
    const listed = after.data?.find(
      (row) => row.id === recorded.scrapRequestId
    );
    expect(listed?.postedAt).not.toBeNull();
    expect(listed).toMatchObject({
      jobReadableId: "J-1",
      quantity: 2,
      estimatedValue: 40,
      createdBy: people.operator,
      approvedBy: people.approver,
      approvalStatus: "Approved"
    });
  });

  it("removes the record of a scrap the posting refused", async () => {
    const recorded = await scrapApproval.recordScrapApproval(f.db, {
      companyId: f.companyId,
      scrap: await scrapOf(1),
      recordedBy: people.operator,
      approvedBy: people.approver
    });
    await scrapApproval.discardScrapApproval(f.db, {
      companyId: f.companyId,
      scrapRequestIds: [recorded.scrapRequestId]
    });
    const left = await f.db
      .selectFrom("approvalRequest")
      .select("id")
      .where("documentId", "=", recorded.scrapRequestId)
      .execute();
    const request = await f.db
      .selectFrom("scrapRequest")
      .select("id")
      .where("id", "=", recorded.scrapRequestId)
      .execute();
    expect(left).toHaveLength(0);
    expect(request).toHaveLength(0);
  });

  it("reuses a batch approval only past phase 1 and for the approved quantity", async () => {
    const batch = await f.db
      .insertInto("jobOperationBatch")
      .values({
        readableId: `${f.prefix}-B1`,
        locationId: f.locationId,
        processId: `${f.prefix}-process-1`,
        status: "Active",
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await scrapApproval.recordScrapApproval(f.db, {
      companyId: f.companyId,
      scrap: await scrapApproval.describeScrap(f.db, f.companyId, {
        type: "batch",
        jobOperationBatchId: batch.id,
        members: [{ jobOperationId: job.operationId, scrapQuantity: 2 }]
      }),
      recordedBy: people.operator,
      approvedBy: people.approver
    });
    const reused = (quantity: number) =>
      scrapApproval.hasBatchScrapApproval(f.db, {
        companyId: f.companyId,
        jobOperationBatchId: batch.id,
        quantity
      });

    // A record kept from a failed attempt while the batch is still Active.
    expect(await reused(2)).toBe(false);

    await f.db
      .updateTable("jobOperationBatch")
      .set({ status: "Completing" })
      .where("id", "=", batch.id)
      .where("companyId", "=", f.companyId)
      .execute();
    expect(await reused(2)).toBe(true);
    expect(await reused(3)).toBe(false);
  });

  it("lets only an approver record scrap on a job's quantities", async () => {
    await scrapRules(0);
    const reason = await f.db
      .insertInto("scrapReason")
      .values({ name: `${f.prefix} damaged`, companyId: f.companyId, createdBy: USER })
      .returning("id")
      .executeTakeFirstOrThrow();
    const input = {
      jobOperationId: job.operationId,
      type: "Scrap" as const,
      scrapReasonId: reason.id,
      quantity: 1
    };

    const refused = await createProductionQuantity(
      contextFor(userActor(people.operator)),
      input
    );
    // The operator is on the rule too: at a desk an approver signs their
    // own, so take them off it to see a refusal.
    expect(refused.error).toBeNull();

    await f.db
      .updateTable("approvalRule")
      .set({ approverGroupIds: [people.approver] })
      .where("companyId", "=", f.companyId)
      .where("documentType", "=", "scrap")
      .execute();
    const outsider = await createProductionQuantity(
      contextFor(userActor(people.operator)),
      input
    );
    expect(outsider.error?.category).toBe("forbidden");

    const approved = await createProductionQuantity(
      contextFor(userActor(people.approver)),
      input
    );
    expect(approved.error).toBeNull();

    const records = await f.db
      .selectFrom("scrapRequest")
      .innerJoin("approvalRequest", (join) =>
        join
          .onRef("approvalRequest.documentId", "=", "scrapRequest.id")
          .on("approvalRequest.documentType", "=", "scrap")
      )
      .select([
        "scrapRequest.createdBy",
        "scrapRequest.postedAt",
        "approvalRequest.decisionBy"
      ])
      .where("scrapRequest.companyId", "=", f.companyId)
      .where("scrapRequest.jobOperationId", "=", job.operationId)
      .where("scrapRequest.createdBy", "in", [
        people.operator,
        people.approver
      ])
      .where("scrapRequest.quantity", "=", 1)
      .execute();
    // The operator's own (while on the rule) and the approver's: both
    // posted, each signed by its recorder.
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.postedAt).not.toBeNull();
      expect(record.decisionBy).toBe(record.createdBy);
    }
  });

  it("refuses scrap written straight to the database while a rule is on", async () => {
    await scrapRules(0);
    const before = await scrappedOnOperation();
    const row = {
      jobOperationId: job.operationId,
      type: "Scrap" as const,
      quantity: 1,
      companyId: f.companyId,
      createdBy: USER
    };

    const inserted = await keyClient
      .from("productionQuantity")
      .insert(row)
      .select("id");
    expect(inserted.error?.code).toBe("42501");

    const edited = await keyClient
      .from("jobOperation")
      .update({ quantityScrapped: before + 5 })
      .eq("id", job.operationId)
      .select("id");
    expect(edited.error?.code).toBe("42501");
    expect(await scrappedOnOperation()).toBe(before);

    const rework = await keyClient
      .from("productionQuantity")
      .insert({ ...row, type: "Rework" })
      .select("id");
    expect(rework.error).toBeNull();
  });

  it("allows direct scrap with no rule on, and removing it with one on", async () => {
    await scrapRules();
    const before = await scrappedOnOperation();
    const inserted = await keyClient
      .from("productionQuantity")
      .insert({
        jobOperationId: job.operationId,
        type: "Scrap",
        quantity: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();
    expect(await scrappedOnOperation()).toBe(before + 1);

    await scrapRules(0);
    const removed = await keyClient
      .from("productionQuantity")
      .delete()
      .eq("id", inserted.data!.id)
      .select("id");
    expect(removed.error).toBeNull();
    expect(await scrappedOnOperation()).toBe(before);
  });

  it("records scrap under every tier through the API while a rule is on", async () => {
    const input = {
      jobOperationId: job.operationId,
      type: "Scrap" as const,
      scrapReasonId: await newScrapReason("api"),
      quantity: 1
    };
    const context = contextFor(apiKeyActor(), keyClient);

    await scrapRules(1000);
    const before = await scrappedOnOperation();
    expect((await createProductionQuantity(context, input)).error).toBeNull();
    expect(await scrappedOnOperation()).toBe(before + 1);

    await scrapRules(0);
    const refused = await createProductionQuantity(context, input);
    expect(refused.error?.category).toBe("forbidden");
    expect(await scrappedOnOperation()).toBe(before + 1);

    await scrapRules();
    expect((await createProductionQuantity(context, input)).error).toBeNull();
    expect(await scrappedOnOperation()).toBe(before + 2);
  });

  it("lets only an approver scrap stock through an inventory adjustment", async () => {
    await approverOnlyRules(0);
    await stockPart(f, 5);
    const input = {
      itemId: f.partId,
      adjustmentType: "Scrap" as const,
      quantity: 2,
      locationId: f.locationId,
      scrapReasonId: await newScrapReason("stock")
    };

    const operator = await adjustInventory(
      contextFor(userActor(people.operator)),
      input
    );
    expect(operator.error?.category).toBe("forbidden");
    const apiKey = await adjustInventory(contextFor(apiKeyActor()), input);
    expect(apiKey.error?.category).toBe("forbidden");

    const approved = await adjustInventory(
      contextFor(userActor(people.approver)),
      input
    );
    expect(approved.error).toBeNull();

    const ledger = await f.db
      .selectFrom("itemLedger")
      .select(["quantity"])
      .where("companyId", "=", f.companyId)
      .where("itemId", "=", f.partId)
      .where("documentType", "=", "Scrap")
      .execute();
    expect(ledger.map((row) => Number(row.quantity))).toEqual([-2]);

    const listed = await scrapApproval.getScrapApprovals(client!, f.companyId, {
      limit: 50,
      offset: 0
    });
    const record = listed.data?.find((row) => row.itemId === f.partId);
    expect(record).toMatchObject({
      jobId: null,
      quantity: 2,
      // Two parts at a unit cost of 10.
      estimatedValue: 20,
      createdBy: people.approver,
      approvedBy: people.approver,
      approvalStatus: "Approved"
    });
    expect(record?.postedAt).not.toBeNull();
  });

  it("removes the approval of an inventory scrap the posting refused", async () => {
    await approverOnlyRules(0);
    const before = await f.db
      .selectFrom("scrapRequest")
      .select("id")
      .where("companyId", "=", f.companyId)
      .execute();

    const refused = await adjustInventory(
      contextFor(userActor(people.approver)),
      {
        itemId: f.partId,
        adjustmentType: "Scrap",
        quantity: 100000,
        locationId: f.locationId,
        scrapReasonId: await newScrapReason("too many")
      }
    );
    expect(refused.error).not.toBeNull();

    const after = await f.db
      .selectFrom("scrapRequest")
      .select("id")
      .where("companyId", "=", f.companyId)
      .execute();
    expect(after).toHaveLength(before.length);
  });

  it("values a tracked scrap with no quantity at the whole entity", async () => {
    // The posting reads quantity 0 as "all of it", as the serial screens send.
    const entity = await f.db
      .insertInto("trackedEntity")
      .values({
        companyId: f.companyId,
        itemId: f.partId,
        quantity: 4,
        status: "Available",
        sourceDocument: "Item",
        sourceDocumentId: f.partId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    expect(
      await scrapApproval.describeScrap(f.db, f.companyId, {
        type: "item",
        itemId: f.partId,
        trackedEntityId: entity.id,
        quantity: 0
      })
    ).toMatchObject({
      itemId: f.partId,
      trackedEntityId: entity.id,
      quantity: 4,
      estimatedValue: 40
    });

    // The posting values the item it is given, so the lot must be that item.
    await expect(
      scrapApproval.describeScrap(f.db, f.companyId, {
        type: "item",
        itemId: f.assemblyId,
        trackedEntityId: entity.id,
        quantity: 100
      })
    ).rejects.toThrow();
  });

  // Receipt lots held for inspection in one goods-in unit, received through
  // the real posting; set up once for the tests that use them.
  const heldUnit = () => `${f.prefix}-qc`;
  let heldUnitReady: Promise<void> | null = null;
  const setUpHeldUnit = () => {
    heldUnitReady ??= seed(f, async (trx) => {
      await trx
        .insertInto("storageUnit")
        .values({
          id: heldUnit(),
          name: heldUnit(),
          locationId: f.locationId,
          nettable: false,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      // No rejected storage unit: a Partial lot's remainder stays held where
      // it was received until its issue closes.
      await trx
        .updateTable("location")
        .set({
          inspectionStorageUnitId: heldUnit(),
          rejectedStorageUnitId: null
        })
        .where("id", "=", f.locationId)
        .where("companyId", "=", f.companyId)
        .execute();
      await trx
        .insertInto("sequence")
        .values(
          [
            { table: "inspection", name: "Inspection", prefix: "INS-" },
            { table: "nonConformance", name: "Issue", prefix: "NCR" }
          ].map((row) => ({ ...row, companyId: f.companyId }))
        )
        .onConflict((oc) => oc.doNothing())
        .execute();
      const document = await trx
        .insertInto("inspectionDocument")
        .values({ partId: f.partId, companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("itemInspectionDocumentAssignment")
        .values({
          itemId: f.partId,
          usage: "Receipt",
          inspectionDocumentId: document.id,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("nonConformanceType")
        .values({
          name: `${f.prefix} receiving`,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
    return heldUnitReady;
  };
  // The postings below run with the interceptors on, as in the app.
  const withTriggers = async <T>(run: () => Promise<T>) => {
    await sql`SELECT set_config('app.sync_in_progress', 'false', false)`.execute(
      f.db
    );
    try {
      return await run();
    } finally {
      await sql`SELECT set_config('app.sync_in_progress', 'true', false)`.execute(
        f.db
      );
    }
  };
  /** Ten parts received into the held unit: their lot's id. */
  const receiveHeldLot = async (key: string) => {
    await setUpHeldUnit();
    const receiptId = await draftReceiptFromPurchaseOrder(f, key);
    await seed(f, (trx) =>
      trx
        .updateTable("receiptLine")
        .set({ storageUnitId: heldUnit() })
        .where("receiptId", "=", receiptId)
        .where("companyId", "=", f.companyId)
        .execute()
    );
    const received = await invokePosting(
      handlesOf(f.ctx),
      "post-receipt",
      { type: "post", receiptId },
      postReceipt
    );
    expect(received.error).toBeNull();
    const lot = await f.db
      .selectFrom("inspection")
      .select("id")
      .where("sourceDocumentId", "=", receiptId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    return lot.id;
  };
  const inHeldUnit = async () =>
    Number(
      (
        await f.db
          .selectFrom("itemLedger")
          .select(sql<number>`COALESCE(SUM("quantity"), 0)`.as("quantity"))
          .where("companyId", "=", f.companyId)
          .where("itemId", "=", f.partId)
          .where("storageUnitId", "=", heldUnit())
          .executeTakeFirstOrThrow()
      ).quantity
    );

  it("lets only an approver complete an issue that scraps a lot's held remainder", async () => {
    await approverOnlyRules(0);
    // Ten received into the held unit, six accepted: four stay held for the NCR.
    const lotId = await receiveHeldLot("held");
    const partial = await withTriggers(() =>
      partialInspection(contextFor({ type: "system", onBehalfOf: USER }), {
        id: lotId,
        acceptedQuantity: 6,
        createNcr: true
      })
    );
    expect(partial.error).toBeNull();
    const issueId = partial.data!.issueId!;
    await seed(f, (trx) =>
      trx
        .updateTable("nonConformanceItem")
        .set({ disposition: "Scrap" })
        .where("nonConformanceId", "=", issueId)
        .where("companyId", "=", f.companyId)
        .execute()
    );
    // The six accepted stay in the unit until put away.
    const status = async () =>
      (
        await f.db
          .selectFrom("nonConformance")
          .select("status")
          .where("id", "=", issueId)
          .executeTakeFirstOrThrow()
      ).status;
    expect(await inHeldUnit()).toBe(10);

    const operator = await withTriggers(() =>
      completeIssue(contextFor(userActor(people.operator)), { id: issueId })
    );
    expect(operator.error?.category).toBe("forbidden");
    const apiKey = await withTriggers(() =>
      completeIssue(contextFor(apiKeyActor()), { id: issueId })
    );
    expect(apiKey.error?.category).toBe("forbidden");
    expect(await inHeldUnit()).toBe(10);
    expect(await status()).not.toBe("Closed");

    const approved = await withTriggers(() =>
      completeIssue(contextFor(userActor(people.approver)), { id: issueId })
    );
    expect(approved.error).toBeNull();
    expect(await status()).toBe("Closed");
    expect(await inHeldUnit()).toBe(6);

    const listed = await scrapApproval.getScrapApprovals(client!, f.companyId, {
      limit: 50,
      offset: 0
    });
    const records = listed.data?.filter(
      (row) => row.itemId === f.partId && row.quantity === 4
    );
    expect(records).toHaveLength(1);
    expect(records?.[0]).toMatchObject({
      jobId: null,
      // Four parts at a unit cost of 10.
      estimatedValue: 40,
      createdBy: people.approver,
      approvedBy: people.approver,
      approvalStatus: "Approved"
    });
    expect(records?.[0]?.postedAt).not.toBeNull();
  }, 60_000);

  it("lets only an approver reject an untracked lot, which writes its stock off", async () => {
    await approverOnlyRules(0);
    const lotId = await receiveHeldLot("rejected");
    const before = await inHeldUnit();
    const status = async () =>
      (
        await f.db
          .selectFrom("inspection")
          .select("status")
          .where("id", "=", lotId)
          .executeTakeFirstOrThrow()
      ).status;
    const reject = (actor: Actor) =>
      withTriggers(() =>
        rejectInspection(contextFor(actor), {
          id: lotId,
          reason: "Wrong part",
          createNcr: false,
          requireOpen: true
        })
      );

    expect((await reject(userActor(people.operator))).error?.category).toBe(
      "forbidden"
    );
    expect((await reject(apiKeyActor())).error?.category).toBe("forbidden");
    expect(await status()).toBe("Pending");
    expect(await inHeldUnit()).toBe(before);

    const approved = await reject(userActor(people.approver));
    expect(approved.error).toBeNull();
    expect(await status()).toBe("Failed");
    expect(await inHeldUnit()).toBe(before - 10);

    const listed = await scrapApproval.getScrapApprovals(client!, f.companyId, {
      limit: 50,
      offset: 0
    });
    const records = listed.data?.filter(
      (row) => row.itemId === f.partId && row.quantity === 10
    );
    expect(records).toHaveLength(1);
    expect(records?.[0]).toMatchObject({
      jobId: null,
      // Ten parts at a unit cost of 10.
      estimatedValue: 100,
      createdBy: people.approver,
      approvedBy: people.approver,
      approvalStatus: "Approved"
    });
    expect(records?.[0]?.postedAt).not.toBeNull();
  }, 60_000);

  it("asks no approval to reject again a decided lot that held its stock", async () => {
    await approverOnlyRules(0);
    const lotId = await receiveHeldLot("decided");
    // A lot decided while its stock had left the unit: Reject again takes
    // nothing from it, so there is nothing to approve.
    await seed(f, (trx) =>
      trx
        .updateTable("inspection")
        .set({ status: "Failed" })
        .where("id", "=", lotId)
        .execute()
    );
    const before = await inHeldUnit();
    const again = await withTriggers(() =>
      rejectInspection(contextFor(userActor(people.operator)), {
        id: lotId,
        reason: "Wrong part",
        createNcr: false
      })
    );
    expect(again.error).toBeNull();
    expect(await inHeldUnit()).toBe(before);
  }, 60_000);

  it("refuses to value scrap of another company's tracked entity", async () => {
    const foreign = `${f.prefix}-not-this-company`;
    await expect(
      scrapApproval.describeScrap(f.db, f.companyId, {
        type: "operation",
        jobOperationId: job.operationId,
        quantity: 1,
        trackedEntityId: foreign
      })
    ).rejects.toThrow("Tracked entity not found");
    await expect(
      scrapApproval.describeScrap(f.db, f.companyId, {
        type: "item",
        itemId: f.partId,
        quantity: 1,
        trackedEntityId: foreign
      })
    ).rejects.toThrow("Tracked entity not found");
  });

  it("refuses an approver when the tier lookup fails", async () => {
    await scrapRules(0, 500);
    // The operator approves only the lowest tier; scrap of 600 is above it.
    await f.db
      .updateTable("approvalRule")
      .set({ approverGroupIds: [people.operator] })
      .where("companyId", "=", f.companyId)
      .where("documentType", "=", "scrap")
      .where("lowerBoundAmount", "=", 0)
      .execute();
    // The service role with the tier lookup (the one single-row approval
    // rule read) failing, as a dropped connection would.
    const failingTierLookup = new Proxy(client!, {
      get(target, prop, receiver) {
        if (prop !== "from") return Reflect.get(target, prop, receiver);
        return (table: string) => {
          const wrap = (builder: object): object =>
            new Proxy(builder, {
              get(inner, key) {
                if (key === "maybeSingle" && table === "approvalRule") {
                  return () =>
                    Promise.resolve({
                      data: null,
                      error: { message: "Tier lookup failed" }
                    });
                }
                const value = Reflect.get(inner, key);
                if (typeof value !== "function") return value;
                return (...args: unknown[]) => {
                  const result = value.apply(inner, args);
                  return result && typeof result.eq === "function"
                    ? wrap(result)
                    : result;
                };
              }
            });
          return wrap(target.from(table as "approvalRule"));
        };
      }
    });

    const authority = await scrapApproval.authorizeScrapApprover(
      failingTierLookup,
      {
        companyId: f.companyId,
        approverId: people.operator,
        recordedBy: people.approver,
        estimatedValue: 600
      }
    );
    expect(authority.error?.code).toBe("forbidden");
  });

  it("refuses a scrap correction when the quantity changed after it was read", async () => {
    await approverOnlyRules(0);
    const scrapReasonId = await newScrapReason("correction");
    const created = await createProductionQuantity(
      contextFor(userActor(people.approver)),
      {
        jobOperationId: job.operationId,
        type: "Scrap",
        scrapReasonId,
        quantity: 1
      }
    );
    expect(created.error).toBeNull();
    const rowId = created.data!.id;
    const quantityOf = async () =>
      Number(
        (
          await f.db
            .selectFrom("productionQuantity")
            .select("quantity")
            .where("id", "=", rowId)
            .executeTakeFirstOrThrow()
        ).quantity
      );

    // Another correction lands between the read and the write: here, while
    // the approval is recorded.
    const trigger = `${f.prefix.replaceAll("-", "_")}_concurrent_correction`;
    await sql
      .raw(
        `CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN
           UPDATE "productionQuantity" SET "quantity" = 5 WHERE "id" = '${rowId}';
           RETURN NEW;
         END $$;
         CREATE TRIGGER "${trigger}" AFTER INSERT ON "scrapRequest"
           FOR EACH ROW WHEN (NEW."companyId" = '${f.companyId}')
           EXECUTE FUNCTION "${trigger}"();`
      )
      .execute(f.db);
    try {
      const corrected = await updateProductionQuantity(
        contextFor(userActor(people.approver)),
        {
          id: rowId,
          jobOperationId: job.operationId,
          type: "Scrap",
          scrapReasonId,
          quantity: 3
        }
      );
      expect(corrected.error?.category).toBe("conflict");
      expect(await quantityOf()).toBe(5);
    } finally {
      await sql
        .raw(
          `DROP TRIGGER "${trigger}" ON "scrapRequest"; DROP FUNCTION "${trigger}"();`
        )
        .execute(f.db);
    }
  }, 60_000);
});
