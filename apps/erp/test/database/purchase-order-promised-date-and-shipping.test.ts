// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack; skipped without one. The company's promised
// date rule on finalize and approval, and the Shipping card's dates on a
// released order.

import { getPostgresClient, type KyselyDatabase } from "@carbon/database/client";
import { PostgresDriver, sql } from "kysely";
import { Pool } from "pg";
import { expect, vi } from "vitest";
import { fixture, type PurchasingFixture, test } from "./fixtures/purchasing";

// Approval rules are a commercial feature, off in the community edition that
// an unset CARBON_EDITION reads as. Set before @carbon/env is imported.
vi.hoisted(() => {
  process.env.CARBON_EDITION = "enterprise";
});

const purchasing = await import(
  "../../app/modules/purchasing/purchasing.server"
);

async function requirePromisedDate(f: PurchasingFixture) {
  await sql`
    UPDATE "companySettings"
    SET "requirePromisedDateToFinalizePurchaseOrder" = true
    WHERE id = ${f.companyId}
  `.execute(f.db);
}

test("the promised date rule refuses an order with no date", async () => {
  const f = await fixture({ approver: null });
  try {
    await requirePromisedDate(f);

    const result = await purchasing.finalizePurchaseOrderAndNotify(
      f.contextAs("system"),
      { purchaseOrderId: f.ids.order }
    );

    expect(result.error?.message).toContain("promised date");
    expect((await f.order())?.status).toBe("Draft");
  } finally {
    await f.cleanup();
  }
});

test("one promised date on the order passes the rule", async () => {
  const f = await fixture({ approver: null });
  try {
    await requirePromisedDate(f);
    await sql`
      UPDATE "purchaseOrderDelivery" SET "receiptPromisedDate" = '2026-12-01'
      WHERE id = ${f.ids.order}
    `.execute(f.db);

    const result = await purchasing.finalizePurchaseOrderAndNotify(
      f.contextAs("system"),
      { purchaseOrderId: f.ids.order }
    );

    expect(result.error).toBeNull();
    expect((await f.order())?.status).toBe("Needs Approval");
  } finally {
    await f.cleanup();
  }
});

test("the rule refuses an approval when the date was cleared", async () => {
  const f = await fixture({
    status: "Needs Approval",
    approver: "system",
    pendingRequest: true
  });
  try {
    await requirePromisedDate(f);

    const result = await purchasing.decidePurchaseOrderApproval(
      f.contextAs("system"),
      {
        purchaseOrderId: f.ids.order,
        approvalRequestId: f.ids.request,
        decision: "Approved"
      }
    );

    expect(result.error?.message).toContain("promised date");
    expect((await f.order())?.status).toBe("Needs Approval");
    expect((await f.requests()).map((r) => r.status)).toEqual(["Pending"]);
  } finally {
    await f.cleanup();
  }
});

test("a released order saves shipping details until it locks", async () => {
  const f = await fixture({ status: "To Receive" });
  // The edit lock holds one connection while the edit runs on another.
  const pg = getPostgresClient<KyselyDatabase>(
    new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 3 }),
    PostgresDriver
  );
  const shipping = {
    id: "",
    trackingNumber: "T-1",
    shippedDate: "2026-11-02",
    expectedReceiptDate: "2026-11-20",
    dropShipment: false
  };
  try {
    const saved = await purchasing.updatePurchaseOrderDelivery(
      f.contextAs("system", f.companyId, pg),
      { ...shipping, id: f.ids.order }
    );
    expect(saved.error).toBeNull();

    const delivery = await f.db
      .selectFrom("purchaseOrderDelivery")
      .select(["trackingNumber", "shippedDate", "expectedReceiptDate"])
      .where("id", "=", f.ids.order)
      .executeTakeFirst();
    expect(delivery).toEqual({
      trackingNumber: "T-1",
      shippedDate: "2026-11-02",
      expectedReceiptDate: "2026-11-20"
    });

    for (const status of ["Needs Approval", "Completed", "Closed"] as const) {
      await sql`
        UPDATE "purchaseOrder" SET status = ${status} WHERE id = ${f.ids.order}
      `.execute(f.db);
      const refused = await purchasing.updatePurchaseOrderDelivery(
        f.contextAs("system", f.companyId, pg),
        { ...shipping, id: f.ids.order, trackingNumber: "T-2" }
      );
      expect(refused.error, status).not.toBeNull();
    }
  } finally {
    await pg.destroy();
    await f.cleanup();
  }
});
