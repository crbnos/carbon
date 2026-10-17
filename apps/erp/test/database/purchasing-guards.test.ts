// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. The purchase order approval checks of the
// purchasing operations: an API or MCP caller reaches the operation, not the
// route, so the operation is what has to refuse.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { expect, it, vi } from "vitest";
import {
  connectLocalTestDatabase,
  hasLocalDatabase
} from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

// Approval rules are a commercial feature, off in the community edition that
// an unset CARBON_EDITION reads as. Set before @carbon/env is imported.
vi.hoisted(() => {
  process.env.CARBON_EDITION = "enterprise";
});

const purchasing = await import(
  "../../app/modules/purchasing/purchasing.server"
);

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const test = (name: string, fn: () => Promise<void>) =>
  it.skipIf(!client)(name, fn, 60_000);

type Setup = {
  status?: "Draft" | "Needs Approval" | "To Receive";
  /** The company's approval rule for purchase orders, from 0. */
  approver?: string | null;
  pendingRequest?: boolean;
  createdFromPlanning?: boolean;
  skipApprovalForPlanningPurchaseOrders?: boolean;
};

// Two companies. The first has a supplier, a part and one purchase order for
// 5 × 8 = 40, optionally needing approval with a pending request by "system".
async function fixture(setup: Setup = {}) {
  const db = await connectLocalTestDatabase();
  const p = `pgtest-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const companyId = `${p}-company`;
  const otherCompanyId = `${p}-other`;
  const groupId = `${p}-group`;
  // Its own group: companies of one group trade with each other, and their
  // intercompany suppliers refuse the cleanup's delete.
  const otherGroupId = `${p}-other-group`;
  const ids = {
    supplier: `${p}-supplier`,
    interaction: `${p}-interaction`,
    item: `${p}-item`,
    order: `${p}-po`,
    request: `${p}-request`
  };

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await sql`
      INSERT INTO "companyGroup" (id, name, "createdBy") VALUES
        (${groupId}, ${p}, 'system'),
        (${otherGroupId}, ${`${p}-other`}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "company" (id, name, "companyGroupId", "baseCurrencyCode") VALUES
        (${companyId}, ${p}, ${groupId}, 'USD'),
        (${otherCompanyId}, ${`${p}-other`}, ${otherGroupId}, 'USD')
    `.execute(trx);
    await sql`
      UPDATE "companySettings"
      SET "skipApprovalForPlanningPurchaseOrders" = ${setup.skipApprovalForPlanningPurchaseOrders ?? true}
      WHERE id = ${companyId}
    `.execute(trx);
    await sql`
      INSERT INTO "supplier" (id, name, "readableId", "companyId", "createdBy")
      VALUES (${ids.supplier}, 'One', 'S1', ${companyId}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
      VALUES ('EA', 'Each', ${companyId}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "item" (id, "readableId", name, type, "replenishmentSystem", "defaultMethodType",
        "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
      VALUES (${ids.item}, 'P-1', 'Part', 'Part', 'Buy', 'Pull from Inventory', 'Inventory', 'EA',
        ${companyId}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "supplierInteraction" (id, "companyId", "supplierId")
      VALUES (${ids.interaction}, ${companyId}, ${ids.supplier})
    `.execute(trx);
    await sql`
      INSERT INTO "purchaseOrder" (id, "purchaseOrderId", "supplierId", "supplierInteractionId",
        status, "createdFromPlanning", "currencyCode", "exchangeRate", "companyId", "createdBy")
      VALUES (${ids.order}, 'PO-T', ${ids.supplier}, ${ids.interaction},
        ${setup.status ?? "Draft"}, ${setup.createdFromPlanning ?? false}, 'USD', 1,
        ${companyId}, 'system')
    `.execute(trx);
    // The order's interceptor makes these; the fixture runs with it off.
    await sql`
      INSERT INTO "purchaseOrderDelivery" (id, "companyId") VALUES (${ids.order}, ${companyId})
    `.execute(trx);
    await sql`
      INSERT INTO "purchaseOrderPayment" (id, "companyId") VALUES (${ids.order}, ${companyId})
    `.execute(trx);
    await sql`
      INSERT INTO "purchaseOrderLine" ("purchaseOrderId", "purchaseOrderLineType", "itemId",
        "purchaseQuantity", "supplierUnitPrice", "exchangeRate", "conversionFactor",
        "companyId", "createdBy")
      VALUES (${ids.order}, 'Part', ${ids.item}, 5, 8, 1, 1, ${companyId}, 'system')
    `.execute(trx);
    if (setup.approver !== undefined) {
      await sql`
        INSERT INTO "approvalRule" ("documentType", "defaultApproverId", "lowerBoundAmount",
          "companyId", "createdBy")
        VALUES ('purchaseOrder', ${setup.approver}, 0, ${companyId}, 'system')
      `.execute(trx);
    }
    if (setup.pendingRequest) {
      await sql`
        INSERT INTO "approvalRequest" (id, "documentType", "documentId", amount, "requestedBy",
          "companyId", "createdBy")
        VALUES (${ids.request}, 'purchaseOrder', ${ids.order}, 40, 'system', ${companyId}, 'system')
      `.execute(trx);
    }
  });

  const contextAs = (userId: string, company = companyId, pg = db) =>
    createServiceContext({
      actor: { type: "system", onBehalfOf: userId },
      company: {
        id: company,
        groupId: company === companyId ? groupId : otherGroupId
      },
      caller: client!,
      system: () => client!,
      pg: () => pg,
      kv: () => {
        throw new Error("No operation here reads the cache");
      }
    });

  return {
    db,
    companyId,
    otherCompanyId,
    ids,
    contextAs,
    order: () =>
      db
        .selectFrom("purchaseOrder")
        .select(["status"])
        .where("id", "=", ids.order)
        .executeTakeFirst(),
    requests: () =>
      db
        .selectFrom("approvalRequest")
        .select(["id", "status", "amount"])
        .where("documentId", "=", ids.order)
        .orderBy("requestedAt")
        .execute(),
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .deleteFrom("company")
          .where("id", "in", [companyId, otherCompanyId])
          .execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "in", [groupId, otherGroupId])
          .execute();
        for (const id of [companyId, otherCompanyId]) {
          await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${id}`)}`.execute(
            trx
          );
          await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${id}`)}`.execute(
            trx
          );
        }
      });
      await db.destroy();
    }
  };
}

test("a delete that fails leaves the approval requests pending", async () => {
  const f = await fixture({ status: "Needs Approval", pendingRequest: true });
  try {
    // An invoice line still names the order: the delete is refused.
    await sql`
      INSERT INTO "purchaseInvoice" (id, "invoiceId", "currencyCode", "supplierInteractionId",
        "companyId", "createdBy")
      VALUES (${`${f.ids.order}-invoice`}, 'PI-T', 'USD', ${f.ids.interaction},
        ${f.companyId}, 'system')
    `.execute(f.db);
    await sql`
      INSERT INTO "purchaseInvoiceLine" ("invoiceId", "invoiceLineType", description,
        "purchaseOrderId", "companyId", "createdBy")
      VALUES (${`${f.ids.order}-invoice`}, 'Comment', 'Note', ${f.ids.order}, ${f.companyId},
        'system')
    `.execute(f.db);

    const result = await purchasing.deletePurchaseOrders(
      f.contextAs("system"),
      {
        purchaseOrderIds: [f.ids.order]
      }
    );

    expect(result.error).not.toBeNull();
    expect((await f.order())?.status).toBe("Needs Approval");
    expect((await f.requests()).map((r) => r.status)).toEqual(["Pending"]);
  } finally {
    await f.cleanup();
  }
});

test("closing cancels the pending approval requests", async () => {
  const f = await fixture({ status: "Needs Approval", pendingRequest: true });
  try {
    const result = await purchasing.closePurchaseOrderAndApprovals(
      f.contextAs("system"),
      { purchaseOrderId: f.ids.order }
    );

    expect(result.error).toBeNull();
    expect((await f.order())?.status).toBe("Closed");
    expect((await f.requests()).map((r) => r.status)).toEqual(["Cancelled"]);
  } finally {
    await f.cleanup();
  }
});

test("only the requester or an approver reopens an order in approval", async () => {
  const f = await fixture({
    status: "Needs Approval",
    approver: null,
    pendingRequest: true
  });
  try {
    const refused = await purchasing.reopenPurchaseOrder(
      f.contextAs("someone-else"),
      { purchaseOrderId: f.ids.order, status: "Draft" }
    );
    expect(refused.error).toMatchObject({ category: "forbidden" });
    expect((await f.order())?.status).toBe("Needs Approval");
    expect((await f.requests()).map((r) => r.status)).toEqual(["Pending"]);

    const reopened = await purchasing.reopenPurchaseOrder(
      f.contextAs("system"),
      { purchaseOrderId: f.ids.order, status: "Draft" }
    );
    expect(reopened.error).toBeNull();
    expect((await f.order())?.status).toBe("Draft");
    expect((await f.requests()).map((r) => r.status)).toEqual(["Cancelled"]);
  } finally {
    await f.cleanup();
  }
});

test("an approval request of another company is not found", async () => {
  const f = await fixture({
    status: "Needs Approval",
    approver: "system",
    pendingRequest: true
  });
  try {
    const result = await purchasing.decidePurchaseOrderApproval(
      f.contextAs("system", f.otherCompanyId),
      {
        purchaseOrderId: f.ids.order,
        approvalRequestId: f.ids.request,
        decision: "Rejected"
      }
    );

    expect(result.error).toMatchObject({ category: "notFound" });
    expect((await f.order())?.status).toBe("Needs Approval");
    expect((await f.requests()).map((r) => r.status)).toEqual(["Pending"]);
  } finally {
    await f.cleanup();
  }
});

test("only an approver of the order's tier decides", async () => {
  const f = await fixture({
    status: "Needs Approval",
    approver: "system",
    pendingRequest: true
  });
  try {
    const refused = await purchasing.decidePurchaseOrderApproval(
      f.contextAs("someone-else"),
      {
        purchaseOrderId: f.ids.order,
        approvalRequestId: f.ids.request,
        decision: "Rejected"
      }
    );
    expect(refused.error).toMatchObject({ category: "forbidden" });
    expect((await f.requests()).map((r) => r.status)).toEqual(["Pending"]);

    const decided = await purchasing.decidePurchaseOrderApproval(
      f.contextAs("system"),
      {
        purchaseOrderId: f.ids.order,
        approvalRequestId: f.ids.request,
        decision: "Rejected"
      }
    );
    expect(decided.error).toBeNull();
    expect((await f.order())?.status).toBe("Rejected");
    expect((await f.requests()).map((r) => r.status)).toEqual(["Rejected"]);
  } finally {
    await f.cleanup();
  }
});

test("an order the approval rule covers goes to approval on finalize", async () => {
  const f = await fixture({ approver: null });
  try {
    const result = await purchasing.finalizePurchaseOrderAndNotify(
      f.contextAs("system"),
      { purchaseOrderId: f.ids.order }
    );

    expect(result.error).toBeNull();
    expect(result.data?.needsApproval).toBe(true);
    expect((await f.order())?.status).toBe("Needs Approval");
    const requests = await f.requests();
    expect(requests.map((r) => r.status)).toEqual(["Pending"]);
    expect(Number(requests[0]?.amount)).toBe(40);
  } finally {
    await f.cleanup();
  }
});

test("an approval request that cannot be opened leaves the order unreleased", async () => {
  const f = await fixture({ approver: null });
  // The database refuses the approval request: this connection only, at the
  // query boundary, so nothing else running sees it.
  const refusing = f.db.withPlugin({
    transformQuery({ node }) {
      if (
        node.kind === "InsertQueryNode" &&
        JSON.stringify(node.into).includes('"approvalRequest"')
      ) {
        throw new Error("approval request refused");
      }
      return node;
    },
    async transformResult({ result }) {
      return result;
    }
  });
  try {
    const result = await purchasing.finalizePurchaseOrderAndNotify(
      f.contextAs("system", f.companyId, refusing),
      { purchaseOrderId: f.ids.order }
    );

    expect(result.error).toMatchObject({ category: "internal" });
    expect((await f.order())?.status).toBe("Draft");
    expect(await f.requests()).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

test("a planning order skips approval only when the company allows it", async () => {
  const kept = await fixture({
    approver: null,
    createdFromPlanning: true,
    skipApprovalForPlanningPurchaseOrders: false
  });
  try {
    const result = await purchasing.finalizePurchaseOrderAndNotify(
      kept.contextAs("system"),
      { purchaseOrderId: kept.ids.order }
    );
    expect(result.data?.needsApproval).toBe(true);
    expect((await kept.order())?.status).toBe("Needs Approval");
  } finally {
    await kept.cleanup();
  }

  const skipped = await fixture({
    approver: null,
    createdFromPlanning: true,
    skipApprovalForPlanningPurchaseOrders: true
  });
  try {
    const result = await purchasing.finalizePurchaseOrderAndNotify(
      skipped.contextAs("system"),
      { purchaseOrderId: skipped.ids.order }
    );
    // Past the gate it renders and stores the PDF, which this fixture company
    // is not set up for; the gate is what is under test.
    expect(result.data?.needsApproval).not.toBe(true);
    expect((await skipped.order())?.status).toBe("To Receive and Invoice");
    expect(await skipped.requests()).toEqual([]);
  } finally {
    await skipped.cleanup();
  }
});

test("a header update writes only header fields, and not on a finalized order", async () => {
  const draft = await fixture();
  const header = (f: typeof draft) =>
    f.db
      .selectFrom("purchaseOrder")
      .select(["status", "createdFromPlanning", "supplierReference"])
      .where("id", "=", f.ids.order)
      .executeTakeFirst();
  try {
    const result = await purchasing.updatePurchaseOrder(
      draft.contextAs("system"),
      {
        id: draft.ids.order,
        supplierReference: "REF-1",
        // Not header fields: an API body cannot release or re-route an order.
        status: "To Receive",
        createdFromPlanning: true
      } as never
    );
    expect(result.error).toBeNull();
    expect(await header(draft)).toEqual({
      status: "Draft",
      createdFromPlanning: false,
      supplierReference: "REF-1"
    });
  } finally {
    await draft.cleanup();
  }

  const released = await fixture({ status: "To Receive" });
  try {
    const result = await purchasing.updatePurchaseOrder(
      released.contextAs("system"),
      { id: released.ids.order, supplierReference: "REF-2" }
    );
    expect(result.error).toMatchObject({ category: "rule" });
    expect((await header(released))?.supplierReference).toBeNull();
  } finally {
    await released.cleanup();
  }
});

test("a supplier bank account takes only its own columns from the body", async () => {
  const f = await fixture();
  try {
    const created = await purchasing.createSupplierBankAccount(
      f.contextAs("system"),
      {
        supplierId: f.ids.supplier,
        name: "Operating",
        bankName: "Bank",
        bankAddress: "1 Bank Way",
        countryCode: "US",
        accountNumber: "123456789",
        isPrimary: true,
        active: false,
        createdAt: "2001-01-01T00:00:00Z"
      }
    );
    expect(created.error).toBeNull();

    const row = await f.db
      .selectFrom("supplierBankAccount")
      .select(["id", "isPrimary", "active", "createdAt"])
      .where("supplierId", "=", f.ids.supplier)
      .executeTakeFirstOrThrow();
    expect(row.isPrimary).toBe(false);
    expect(row.active).toBe(true);
    expect(String(row.createdAt)).not.toContain("2001");

    const updated = await purchasing.updateSupplierBankAccount(
      f.contextAs("system"),
      {
        id: row.id,
        supplierId: f.ids.supplier,
        name: "Operating",
        bankName: "Bank",
        bankAddress: "1 Bank Way",
        countryCode: "US",
        accountNumber: "123456789",
        isPrimary: true
      }
    );
    expect(updated.error).toBeNull();
    const after = await f.db
      .selectFrom("supplierBankAccount")
      .select(["isPrimary"])
      .where("id", "=", row.id)
      .executeTakeFirstOrThrow();
    expect(after.isPrimary).toBe(false);
  } finally {
    await f.cleanup();
  }
});
