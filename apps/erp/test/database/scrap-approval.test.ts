// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. Scrap approval: the estimate a scrap rule is
// matched against, who may sign it, the record written before the posting,
// and the ERP's job quantity entry, which only an approver may use.

import {
  type Actor,
  createServiceContext
} from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  USER
} from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

// Approval rules are a commercial feature, off in the community edition that
// an unset CARBON_EDITION reads as. Set before @carbon/env is imported.
vi.hoisted(() => {
  process.env.CARBON_EDITION = "enterprise";
});

const scrapApproval = await import("@carbon/ee/approvals/scrap.server");
const { createProductionQuantity } = await import(
  "../../app/modules/production/production.server"
);

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const describeLocal = describe.skipIf(!client);

let f: Fixture;
let job: Awaited<ReturnType<typeof jobFixture>>;
let people: { approver: string; operator: string };

function userActor(userId: string): Actor {
  const all = [f.companyId];
  return {
    type: "user",
    userId,
    permissions: {
      production: { view: all, create: all, update: all, delete: all }
    }
  };
}

function contextFor(actor: Actor) {
  return createServiceContext({
    actor,
    company: { id: f.companyId, groupId: f.groupId },
    caller: client!,
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
      scrapRequestId: recorded.scrapRequestId,
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
      scrapRequestId: recorded.scrapRequestId
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
});
