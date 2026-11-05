// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. The purchase order approval rule as every
// caller meets it: the funds gate on receipts and invoices, and edits of a
// released order that keep or lose its approval. An API or MCP caller reaches
// the operation, not the route, so the operation is what has to refuse.

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

// A posting run through the local service-role client is recognised as the
// system only when the key matches the one @carbon/env holds.
vi.mock("@carbon/env", async (importOriginal) => {
  const { localServiceRoleKey } = await import("./fixtures/local-supabase");
  return {
    ...(await importOriginal<object>()),
    SUPABASE_SERVICE_ROLE_KEY: localServiceRoleKey() ?? "test"
  };
});

const purchasing = await import(
  "../../app/modules/purchasing/purchasing.server"
);
const purchasingService = await import(
  "../../app/modules/purchasing/purchasing.service"
);
const inventory = await import("../../app/modules/inventory/inventory.server");
const invoicing = await import("../../app/modules/invoicing/invoicing.server");

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const live = it.skipIf(!client);
const test = Object.assign(
  (name: string, fn: () => Promise<void>) => live(name, fn, 60_000),
  {
    each:
      <T extends string>(cases: readonly T[]) =>
      (name: string, fn: (value: T) => Promise<void>) =>
        live.each(cases)(name, fn, 60_000)
  }
);

type Status =
  | "Draft"
  | "Needs Approval"
  | "Rejected"
  | "To Receive"
  | "To Receive and Invoice"
  | "To Invoice"
  | "Completed"
  | "Closed";

type Setup = {
  status?: Status;
  /** An Approved request for this amount; none when omitted. */
  approvedAmount?: number;
  /** A purchase order approval rule from this amount, approved by "system". */
  ruleFrom?: number;
  quantityReceived?: number;
  /** Released through the planning bypass, which the company allows. */
  createdFromPlanning?: boolean;
};

// One company with a supplier, a part and one purchase order of one line:
// 5 × 8 = 40, in USD at rate 1, released (To Receive and Invoice: nothing
// received or invoiced yet).
async function fixture(setup: Setup = {}) {
  const db = await connectLocalTestDatabase();
  const p = `poatest-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const companyId = `${p}-company`;
  const groupId = `${p}-group`;
  const ids = {
    supplier: `${p}-supplier`,
    otherSupplier: `${p}-supplier-2`,
    interaction: `${p}-interaction`,
    item: `${p}-item`,
    order: `${p}-po`,
    line: `${p}-po-line`,
    invoice: `${p}-invoice`
  };

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await sql`
      INSERT INTO "companyGroup" (id, name, "createdBy") VALUES (${groupId}, ${p}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "company" (id, name, "companyGroupId", "baseCurrencyCode")
      VALUES (${companyId}, ${p}, ${groupId}, 'USD')
    `.execute(trx);
    await sql`
      UPDATE "companySettings"
      SET "skipApprovalForPlanningPurchaseOrders" = ${setup.createdFromPlanning ?? false}
      WHERE id = ${companyId}
    `.execute(trx);
    await sql`
      INSERT INTO "supplier" (id, name, "readableId", "companyId", "createdBy") VALUES
        (${ids.supplier}, 'One', 'S1', ${companyId}, 'system'),
        (${ids.otherSupplier}, 'Two', 'S2', ${companyId}, 'system')
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
        ${setup.status ?? "To Receive and Invoice"}, ${setup.createdFromPlanning ?? false}, 'USD', 1,
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
      INSERT INTO "purchaseOrderLine" (id, "purchaseOrderId", "purchaseOrderLineType", "itemId",
        "purchaseQuantity", "supplierUnitPrice", "exchangeRate", "conversionFactor",
        "quantityReceived", "companyId", "createdBy")
      VALUES (${ids.line}, ${ids.order}, 'Part', ${ids.item}, 5, 8, 1, 1,
        ${setup.quantityReceived ?? 0}, ${companyId}, 'system')
    `.execute(trx);
    if (setup.ruleFrom !== undefined) {
      await sql`
        INSERT INTO "approvalRule" ("documentType", "defaultApproverId", "lowerBoundAmount",
          "companyId", "createdBy")
        VALUES ('purchaseOrder', 'system', ${setup.ruleFrom}, ${companyId}, 'system')
      `.execute(trx);
    }
    if (setup.approvedAmount !== undefined) {
      await sql`
        INSERT INTO "approvalRequest" ("documentType", "documentId", status, amount,
          "requestedBy", "decisionBy", "decisionAt", "companyId", "createdBy")
        VALUES ('purchaseOrder', ${ids.order}, 'Approved', ${setup.approvedAmount},
          'system', 'system', now(), ${companyId}, 'system')
      `.execute(trx);
    }
  });

  const ctx = createServiceContext({
    actor: { type: "system", onBehalfOf: "system" },
    company: { id: companyId, groupId },
    caller: client!,
    system: () => client!,
    pg: () => db,
    kv: () => {
      throw new Error("No operation here reads the cache");
    }
  });

  /** A Draft purchase invoice with one line against the order's line. */
  async function invoiceAgainstOrder() {
    await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
      await sql`
        INSERT INTO "purchaseInvoice" (id, "invoiceId", "currencyCode", "supplierInteractionId",
          "companyId", "createdBy")
        VALUES (${ids.invoice}, 'PI-T', 'USD', ${ids.interaction}, ${companyId}, 'system')
      `.execute(trx);
      await sql`
        INSERT INTO "purchaseInvoiceLine" ("invoiceId", "invoiceLineType", "itemId", quantity,
          "supplierUnitPrice", "exchangeRate", "conversionFactor", "purchaseOrderId",
          "purchaseOrderLineId", "companyId", "createdBy")
        VALUES (${ids.invoice}, 'Part', ${ids.item}, 5, 8, 1, 1, ${ids.order}, ${ids.line},
          ${companyId}, 'system')
      `.execute(trx);
    });
  }

  return {
    db,
    companyId,
    ids,
    ctx,
    invoiceAgainstOrder,
    order: () =>
      db
        .selectFrom("purchaseOrder")
        .select(["status", "supplierId", "supplierReference"])
        .where("id", "=", ids.order)
        .executeTakeFirstOrThrow(),
    line: () =>
      db
        .selectFrom("purchaseOrderLine")
        .select(["purchaseQuantity", "supplierUnitPrice", "conversionFactor"])
        .where("id", "=", ids.line)
        .executeTakeFirst(),
    requests: () =>
      db
        .selectFrom("approvalRequest")
        .select(["id", "status", "amount"])
        .where("documentId", "=", ids.order)
        .orderBy("requestedAt")
        .execute()
        .then((rows) =>
          rows.map((r) => ({ ...r, amount: Number(r.amount) }))
        ),
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "=", groupId)
          .execute();
        await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
          trx
        );
        await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
          trx
        );
      });
      await db.destroy();
    }
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** An edit of the order's one line: price and quantity. */
function editLine(
  f: Fixture,
  edit: { supplierUnitPrice?: number; purchaseQuantity?: number }
) {
  return purchasing.updatePurchaseOrderLine(f.ctx, {
    id: f.ids.line,
    purchaseOrderId: f.ids.order,
    purchaseOrderLineType: "Part",
    itemId: f.ids.item,
    ...edit
  });
}

// --- Funds gate -------------------------------------------------------------

test.each(["Draft", "Needs Approval", "Rejected", "Closed"] as const)(
  "a receipt is refused against a %s order",
  async (status) => {
    const f = await fixture({ status });
    try {
      const result = await inventory.createReceipt(f.ctx, {
        sourceDocument: "Purchase Order",
        sourceDocumentId: f.ids.order
      });
      expect(result.error).toMatchObject({ category: "rule" });
      const receipts = await f.db
        .selectFrom("receipt")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(receipts).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

test("a receipt is refused against a released order above its approved amount", async () => {
  // Approved at 30 under a rule from 0; the order totals 40.
  const f = await fixture({ approvedAmount: 30, ruleFrom: 0 });
  try {
    const result = await inventory.createReceipt(f.ctx, {
      sourceDocument: "Purchase Order",
      sourceDocumentId: f.ids.order
    });
    expect(result.error).toMatchObject({ category: "rule" });
  } finally {
    await f.cleanup();
  }
});

test("invoicing an unapproved order is refused", async () => {
  const f = await fixture({ status: "Needs Approval" });
  try {
    const result = await invoicing.createPurchaseInvoiceFromPurchaseOrder(
      f.ctx,
      { purchaseOrderId: f.ids.order }
    );
    expect(result.error).toMatchObject({ category: "rule" });
    const invoices = await f.db
      .selectFrom("purchaseInvoice")
      .select("id")
      .where("companyId", "=", f.companyId)
      .execute();
    expect(invoices).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

test("a closed order's line can still be invoiced", async () => {
  // Closed after its receipts: the supplier's bill for them still comes in.
  const f = await fixture({ status: "Closed", quantityReceived: 5 });
  try {
    await f.invoiceAgainstOrder();
    const result = await invoicing.createPurchaseInvoiceLine(f.ctx, {
      invoiceId: f.ids.invoice,
      invoiceLineType: "Part",
      itemId: f.ids.item,
      quantity: 1,
      supplierUnitPrice: 8,
      purchaseOrderLineId: f.ids.line
    } as never);
    expect(result.error).toBeNull();
    expect((await f.order()).status).toBe("Closed");
  } finally {
    await f.cleanup();
  }
});

test("an invoice line against an unapproved order's line is refused", async () => {
  const f = await fixture({ status: "Draft" });
  try {
    await f.invoiceAgainstOrder();
    const result = await invoicing.createPurchaseInvoiceLine(f.ctx, {
      invoiceId: f.ids.invoice,
      invoiceLineType: "Part",
      itemId: f.ids.item,
      quantity: 1,
      supplierUnitPrice: 8,
      purchaseOrderLineId: f.ids.line
    } as never);
    expect(result.error).toMatchObject({ category: "rule" });
  } finally {
    await f.cleanup();
  }
});

test("posting an invoice against an unapproved order neither posts nor releases it", async () => {
  const f = await fixture({ status: "Draft" });
  try {
    await f.invoiceAgainstOrder();
    const result = await invoicing.postPurchaseInvoice(f.ctx, {
      invoiceId: f.ids.invoice
    });
    expect(result.error).toMatchObject({ category: "rule" });
    const invoice = await f.db
      .selectFrom("purchaseInvoice")
      .select("status")
      .where("id", "=", f.ids.invoice)
      .executeTakeFirstOrThrow();
    expect(invoice.status).toBe("Draft");
    expect((await f.order()).status).toBe("Draft");
  } finally {
    await f.cleanup();
  }
});

// --- Edits of a released order ----------------------------------------------

test("an edit within the approved amount keeps the order released", async () => {
  const f = await fixture({ approvedAmount: 40, ruleFrom: 0 });
  try {
    // 5 × 7 = 35 ≤ 40.
    const result = await editLine(f, { supplierUnitPrice: 7 });
    expect(result.error).toBeNull();
    expect(Number((await f.line())?.supplierUnitPrice)).toBe(7);
    expect((await f.order()).status).toBe("To Receive and Invoice");
    expect(await f.requests()).toEqual([
      expect.objectContaining({ status: "Approved", amount: 40 })
    ]);
  } finally {
    await f.cleanup();
  }
});

test("an edit above the approved amount saves and sends the order back to approval", async () => {
  const f = await fixture({ approvedAmount: 40, ruleFrom: 0 });
  try {
    // 5 × 10 = 50 > 40.
    const result = await editLine(f, { supplierUnitPrice: 10 });
    expect(result.error).toBeNull();
    expect(Number((await f.line())?.supplierUnitPrice)).toBe(10);
    expect((await f.order()).status).toBe("Needs Approval");
    expect(await f.requests()).toEqual([
      expect.objectContaining({ status: "Approved", amount: 40 }),
      expect.objectContaining({ status: "Pending", amount: 50 })
    ]);

    // Receiving waits for the new approval.
    const receipt = await inventory.createReceipt(f.ctx, {
      sourceDocument: "Purchase Order",
      sourceDocumentId: f.ids.order
    });
    expect(receipt.error).toMatchObject({ category: "rule" });

    // Approving the new request releases the order again.
    const pending = (await f.requests())[1]!;
    const decided = await purchasing.decidePurchaseOrderApproval(f.ctx, {
      purchaseOrderId: f.ids.order,
      approvalRequestId: pending.id,
      decision: "Approved"
    });
    expect(decided.error).toBeNull();
    expect((await f.order()).status).toBe("To Receive and Invoice");
  } finally {
    await f.cleanup();
  }
});

test("rejecting an edit puts back the approved version and keeps the order live", async () => {
  const f = await fixture({ approvedAmount: 40, ruleFrom: 0 });
  try {
    // 5 × 10 = 50 > 40: back to approval.
    const edited = await editLine(f, { supplierUnitPrice: 10 });
    expect(edited.error).toBeNull();
    expect((await f.order()).status).toBe("Needs Approval");

    const pending = (await f.requests())[1]!;
    const decided = await purchasing.decidePurchaseOrderApproval(f.ctx, {
      purchaseOrderId: f.ids.order,
      approvalRequestId: pending.id,
      decision: "Rejected"
    });
    expect(decided.error).toBeNull();

    expect(Number((await f.line())?.supplierUnitPrice)).toBe(8);
    expect((await f.order()).status).toBe("To Receive and Invoice");
    expect((await f.requests()).map((r) => r.status)).toEqual([
      "Approved",
      "Rejected"
    ]);

    // The approved version may be received again.
    const funds = await purchasingService.getPurchaseOrderFundsRefusal(
      client!,
      f.companyId,
      [f.ids.order],
      "receive"
    );
    expect(funds).toEqual({ data: null, error: null });
  } finally {
    await f.cleanup();
  }
});

test("rejecting an added line removes it", async () => {
  const f = await fixture({ approvedAmount: 40, ruleFrom: 0 });
  try {
    const added = await purchasing.createPurchaseOrderLine(f.ctx, {
      purchaseOrderId: f.ids.order,
      purchaseOrderLineType: "Part",
      itemId: f.ids.item,
      purchaseQuantity: 1,
      supplierUnitPrice: 5,
      exchangeRate: 1,
      conversionFactor: 1
    } as never);
    expect(added.error).toBeNull();

    const pending = (await f.requests()).at(-1)!;
    await purchasing.decidePurchaseOrderApproval(f.ctx, {
      purchaseOrderId: f.ids.order,
      approvalRequestId: pending.id,
      decision: "Rejected"
    });

    const lines = await f.db
      .selectFrom("purchaseOrderLine")
      .select("id")
      .where("purchaseOrderId", "=", f.ids.order)
      .execute();
    expect(lines).toEqual([{ id: f.ids.line }]);
    expect((await f.order()).status).toBe("To Receive and Invoice");
  } finally {
    await f.cleanup();
  }
});

test("rejecting a first approval leaves the order Rejected", async () => {
  const f = await fixture({ status: "Needs Approval", ruleFrom: 0 });
  try {
    await f.db
      .insertInto("approvalRequest")
      .values({
        documentType: "purchaseOrder",
        documentId: f.ids.order,
        amount: 40,
        requestedBy: "system",
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    const pending = (await f.requests())[0]!;
    const decided = await purchasing.decidePurchaseOrderApproval(f.ctx, {
      purchaseOrderId: f.ids.order,
      approvalRequestId: pending.id,
      decision: "Rejected"
    });
    expect(decided.error).toBeNull();
    expect((await f.order()).status).toBe("Rejected");
  } finally {
    await f.cleanup();
  }
});

test("an increase stays released, and receivable, when no rule covers the new total", async () => {
  // The only rule starts at 1000; the new total is 50. Nobody is asked to
  // approve it, so the old approval of 40 does not hold it either.
  const f = await fixture({ approvedAmount: 40, ruleFrom: 1000 });
  try {
    const result = await editLine(f, { supplierUnitPrice: 10 });
    expect(result.error).toBeNull();
    expect((await f.order()).status).toBe("To Receive and Invoice");
    expect((await f.requests()).map((r) => r.status)).toEqual(["Approved"]);
    const funds = await purchasingService.getPurchaseOrderFundsRefusal(
      client!,
      f.companyId,
      [f.ids.order],
      "receive"
    );
    expect(funds).toEqual({ data: null, error: null });
  } finally {
    await f.cleanup();
  }
});

test("a received line keeps its type", async () => {
  const f = await fixture({ quantityReceived: 3 });
  try {
    const result = await purchasing.updatePurchaseOrderLine(f.ctx, {
      id: f.ids.line,
      purchaseOrderId: f.ids.order,
      purchaseOrderLineType: "G/L Account",
      accountId: "1000"
    });
    expect(result.error).toMatchObject({ category: "rule" });
    const line = await f.db
      .selectFrom("purchaseOrderLine")
      .select(["purchaseOrderLineType", "itemId"])
      .where("id", "=", f.ids.line)
      .executeTakeFirstOrThrow();
    expect(line).toEqual({ purchaseOrderLineType: "Part", itemId: f.ids.item });
  } finally {
    await f.cleanup();
  }
});

test("an edit that leaves the dates out is not a date change", async () => {
  // Received complete with a promised date: the promised date is fixed, but
  // a price edit that does not send it still saves.
  const f = await fixture({ quantityReceived: 5 });
  try {
    await f.db
      .updateTable("purchaseOrderLine")
      .set({ receivedComplete: true, promisedDate: "2026-11-20" })
      .where("id", "=", f.ids.line)
      .execute();
    const result = await editLine(f, { supplierUnitPrice: 7 });
    expect(result.error).toBeNull();
    const line = await f.db
      .selectFrom("purchaseOrderLine")
      .select(["supplierUnitPrice", "promisedDate"])
      .where("id", "=", f.ids.line)
      .executeTakeFirstOrThrow();
    expect(line).toEqual({ supplierUnitPrice: 7, promisedDate: "2026-11-20" });
  } finally {
    await f.cleanup();
  }
});

test("a closed order with nothing received cannot be invoiced", async () => {
  // Cancelled before it was ever released.
  const f = await fixture({ status: "Closed" });
  try {
    const result = await invoicing.createPurchaseInvoiceFromPurchaseOrder(
      f.ctx,
      { purchaseOrderId: f.ids.order }
    );
    expect(result.error).toMatchObject({ category: "rule" });
  } finally {
    await f.cleanup();
  }
});

test("a received line keeps its item, unit and conversion factor", async () => {
  const f = await fixture({ quantityReceived: 3 });
  try {
    const result = await purchasing.updatePurchaseOrderLine(f.ctx, {
      id: f.ids.line,
      purchaseOrderId: f.ids.order,
      purchaseOrderLineType: "Part",
      itemId: f.ids.item,
      conversionFactor: 10
    });
    expect(result.error).toMatchObject({ category: "rule" });
    expect(Number((await f.line())?.conversionFactor ?? 1)).toBe(1);
  } finally {
    await f.cleanup();
  }
});

test("a line added with an id never moves a line from another order", async () => {
  // The line belongs to an order waiting for approval; a Draft order is
  // named as the target.
  const f = await fixture({ status: "Needs Approval" });
  try {
    const draftId = `${f.ids.order}-draft`;
    await f.db
      .insertInto("purchaseOrder")
      .values({
        id: draftId,
        purchaseOrderId: "PO-D",
        supplierId: f.ids.supplier,
        supplierInteractionId: f.ids.interaction,
        status: "Draft",
        currencyCode: "USD",
        exchangeRate: 1,
        companyId: f.companyId,
        createdBy: "system"
      })
      .execute();
    const result = await purchasing.createPurchaseOrderLine(f.ctx, {
      id: f.ids.line,
      purchaseOrderId: draftId,
      purchaseOrderLineType: "Part",
      itemId: f.ids.item,
      purchaseQuantity: 1,
      supplierUnitPrice: 1
    } as never);
    expect(result.error).toBeNull();
    const line = await f.db
      .selectFrom("purchaseOrderLine")
      .select("purchaseOrderId")
      .where("id", "=", f.ids.line)
      .executeTakeFirstOrThrow();
    expect(line.purchaseOrderId).toBe(f.ids.order);
  } finally {
    await f.cleanup();
  }
});

test("an order released with no request needs approval only for an increase", async () => {
  // Released before the rule existed: no approved request.
  const f = await fixture({ ruleFrom: 0 });
  try {
    const lowered = await editLine(f, { supplierUnitPrice: 6 });
    expect(lowered.error).toBeNull();
    expect((await f.order()).status).toBe("To Receive and Invoice");
    expect(await f.requests()).toEqual([]);

    // 30 → 45: above the total before the edit.
    const raised = await editLine(f, { supplierUnitPrice: 9 });
    expect(raised.error).toBeNull();
    expect((await f.order()).status).toBe("Needs Approval");
    expect(await f.requests()).toEqual([
      expect.objectContaining({ status: "Pending", amount: 45 })
    ]);
  } finally {
    await f.cleanup();
  }
});

test("a new line above the approved amount sends the order back to approval", async () => {
  const f = await fixture({ approvedAmount: 40, ruleFrom: 0 });
  try {
    const result = await purchasing.createPurchaseOrderLine(f.ctx, {
      purchaseOrderId: f.ids.order,
      purchaseOrderLineType: "Part",
      itemId: f.ids.item,
      purchaseQuantity: 1,
      supplierUnitPrice: 5,
      exchangeRate: 1,
      conversionFactor: 1
    } as never);
    expect(result.error).toBeNull();
    expect((await f.order()).status).toBe("Needs Approval");
    expect((await f.requests()).at(-1)).toMatchObject({
      status: "Pending",
      amount: 45
    });
  } finally {
    await f.cleanup();
  }
});

test.each(["Needs Approval", "Completed", "Closed"] as const)(
  "a line edit on a %s order is refused and changes nothing",
  async (status) => {
    const f = await fixture({ status });
    try {
      const result = await editLine(f, { supplierUnitPrice: 1 });
      expect(result.error).toMatchObject({ category: "rule" });
      expect(Number((await f.line())?.supplierUnitPrice)).toBe(8);
    } finally {
      await f.cleanup();
    }
  }
);

test("a released line cannot go below what was received, nor be deleted", async () => {
  const f = await fixture({ quantityReceived: 3 });
  try {
    const lowered = await editLine(f, { purchaseQuantity: 2 });
    expect(lowered.error).toMatchObject({ category: "rule" });
    expect(Number((await f.line())?.purchaseQuantity)).toBe(5);

    const atFloor = await editLine(f, { purchaseQuantity: 3 });
    expect(atFloor.error).toBeNull();
    expect(Number((await f.line())?.purchaseQuantity)).toBe(3);

    const deleted = await purchasing.deletePurchaseOrderLine(f.ctx, {
      purchaseOrderLineId: f.ids.line
    });
    expect(deleted.error).toMatchObject({ category: "rule" });
    expect(await f.line()).toBeDefined();
  } finally {
    await f.cleanup();
  }
});

test("a released order's header is editable but its supplier is not", async () => {
  const f = await fixture({ approvedAmount: 40 });
  try {
    const header = await purchasing.updatePurchaseOrder(f.ctx, {
      id: f.ids.order,
      supplierReference: "REF-1"
    });
    expect(header.error).toBeNull();

    const supplier = await purchasing.updatePurchaseOrder(f.ctx, {
      id: f.ids.order,
      supplierId: f.ids.otherSupplier
    });
    expect(supplier.error).toMatchObject({ category: "rule" });

    expect(await f.order()).toEqual({
      status: "To Receive and Invoice",
      supplierId: f.ids.supplier,
      supplierReference: "REF-1"
    });
  } finally {
    await f.cleanup();
  }
});

test("a bulk supplier change is refused on a released order", async () => {
  const f = await fixture();
  try {
    const result = await purchasing.updatePurchaseOrders(f.ctx, {
      ids: [f.ids.order],
      field: "supplierId",
      value: f.ids.otherSupplier
    } as never);
    expect(result.error).toMatchObject({ category: "rule" });
    expect((await f.order()).supplierId).toBe(f.ids.supplier);
  } finally {
    await f.cleanup();
  }
});

test("a hand edit of a planning order released through the bypass needs approval", async () => {
  // Released with no request; a shipping cost is not a line edit.
  const f = await fixture({ createdFromPlanning: true, ruleFrom: 0 });
  try {
    const result = await purchasing.upsertPurchaseOrderDelivery(f.ctx, {
      id: f.ids.order,
      supplierShippingCost: 100,
      trackingNumber: "",
      notes: ""
    } as never);
    expect(result.error).toBeNull();
    // 40 of lines + 100 of shipping.
    expect((await f.order()).status).toBe("Needs Approval");
    expect(await f.requests()).toEqual([
      expect.objectContaining({ status: "Pending", amount: 140 })
    ]);
  } finally {
    await f.cleanup();
  }
});

test.each(["To Receive", "Completed", "Needs Approval"] as const)(
  "a new purchase order cannot start as %s",
  async (status) => {
    const f = await fixture();
    try {
      const result = await purchasing.insertPurchaseOrder(f.ctx, {
        supplierId: f.ids.supplier,
        status
      } as never);
      expect(result.error).toMatchObject({ category: "validation" });
      const orders = await f.db
        .selectFrom("purchaseOrder")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(orders).toHaveLength(1);
    } finally {
      await f.cleanup();
    }
  }
);

test("a rejected order's line cannot go below what was received", async () => {
  // Rejected after a re-approval request: it keeps its receipts.
  const f = await fixture({ status: "Rejected", quantityReceived: 3 });
  try {
    const result = await editLine(f, { purchaseQuantity: 2 });
    expect(result.error).toMatchObject({ category: "rule" });
    expect(Number((await f.line())?.purchaseQuantity)).toBe(5);
  } finally {
    await f.cleanup();
  }
});

test("a line cut to what was received moves the order to To Invoice", async () => {
  const f = await fixture({
    status: "To Receive and Invoice",
    quantityReceived: 3
  });
  try {
    const result = await editLine(f, { purchaseQuantity: 3 });
    expect(result.error).toBeNull();
    expect((await f.order()).status).toBe("To Invoice");
  } finally {
    await f.cleanup();
  }
});

test("a released order keeps a line with nothing received", async () => {
  const f = await fixture({ status: "To Receive and Invoice" });
  try {
    const result = await purchasing.deletePurchaseOrderLine(f.ctx, {
      purchaseOrderLineId: f.ids.line
    });
    expect(result.error).toMatchObject({ category: "rule" });
    expect(await f.line()).toBeDefined();
    expect((await f.order()).status).toBe("To Receive and Invoice");
  } finally {
    await f.cleanup();
  }
});

test("a Draft order loses a line with nothing received", async () => {
  const f = await fixture({ status: "Draft" });
  try {
    const result = await purchasing.deletePurchaseOrderLine(f.ctx, {
      purchaseOrderLineId: f.ids.line
    });
    expect(result.error).toBeNull();
    expect(await f.line()).toBeUndefined();
  } finally {
    await f.cleanup();
  }
});
