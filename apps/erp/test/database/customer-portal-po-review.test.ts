// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import {
  findCustomerPortalOrderByMarker,
  insertCustomerPortalDraftOrder,
  withLockedCustomerPortalPoSubmission
} from "../../app/modules/sales/sales.service";
import { alwaysPostFixture, USER } from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";
import { postgrestTest } from "./fixtures/local-supabase";

databaseTest("a portal PO review sees the first decision on retry", async () => {
  const f = await alwaysPostFixture();
  try {
    const portalId = crypto.randomUUID();
    await f.db.insertInto("externalLink").values({
      id: portalId,
      documentType: "Customer",
      documentId: f.customerId,
      customerId: f.customerId,
      companyId: f.companyId
    }).execute();
    const submission = await f.db.insertInto("customerPortalSubmission").values({
      requestFingerprint: "a".repeat(64),
      companyId: f.companyId,
      portalId,
      customerId: f.customerId,
      submissionType: "PO",
      idempotencyKey: crypto.randomUUID(),
      createdBy: USER
    }).returning("id").executeTakeFirstOrThrow();

    const review = () => withLockedCustomerPortalPoSubmission(
      f.db, f.companyId, submission.id,
      async (trx, row) => {
        if (row.status !== "Pending") return row.status;
        await trx.updateTable("customerPortalSubmission")
          .set({ status: "Rejected", updatedBy: USER })
          .where("id", "=", row.id)
          .where("companyId", "=", f.companyId)
          .execute();
        return row.status;
      }
    );
    expect(await review()).toBe("Pending");
    expect(await review()).toBe("Rejected");
    const stored = await f.db.selectFrom("customerPortalSubmission")
      .select(["status", "salesOrderId"])
      .where("id", "=", submission.id)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({ status: "Rejected", salesOrderId: null });
    expect(await withLockedCustomerPortalPoSubmission(
      f.db, "another-company", submission.id, async () => "visible"
    )).toBeNull();
  } finally {
    await f.cleanup();
  }
});

postgrestTest("an interrupted Draft PO order rolls back its header, payment and shipment", async (client) => {
  const f = await alwaysPostFixture();
  try {
    await f.db.insertInto("sequence").values({
      table: "salesOrder",
      name: "Sales Order",
      prefix: "SO-",
      companyId: f.companyId
    }).execute();
    const submissionId = `${f.prefix}-interrupted-po`;
    const input = {
      companyId: f.companyId,
      customerId: f.customerId,
      createdBy: USER,
      submissionId,
      poNumber: "PO-456",
      requestedDelivery: f.today
    };
    await expect(f.db.transaction().execute(async (trx) => {
      await insertCustomerPortalDraftOrder(trx, client, input);
      throw new Error("interrupted before review receipt");
    })).rejects.toThrow("interrupted before review receipt");
    const absent = await f.db.transaction().execute((trx) =>
      findCustomerPortalOrderByMarker(trx, f.companyId, f.customerId, submissionId)
    );
    expect(absent).toBeUndefined();

    const created = await f.db.transaction().execute((trx) =>
      insertCustomerPortalDraftOrder(trx, client, input)
    );
    const recovered = await f.db.transaction().execute((trx) =>
      findCustomerPortalOrderByMarker(trx, f.companyId, f.customerId, submissionId)
    );
    expect(recovered?.id).toBe(created.id);
    const [order, payment, shipment] = await Promise.all([
      f.db.selectFrom("salesOrder").select(["id", "status"]).where("id", "=", created.id).executeTakeFirst(),
      f.db.selectFrom("salesOrderPayment").select("id").where("id", "=", created.id).executeTakeFirst(),
      f.db.selectFrom("salesOrderShipment").select("id").where("id", "=", created.id).executeTakeFirst()
    ]);
    expect(order).toEqual({ id: created.id, status: "Draft" });
    expect(payment?.id).toBe(created.id);
    expect(shipment?.id).toBe(created.id);
  } finally {
    await f.cleanup();
  }
});
