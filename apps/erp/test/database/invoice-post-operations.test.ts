// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The post operations around the posting bodies: the claim a post takes on
// the invoice, what a failed post gives back, and a failure after the post.
// Runs against the local stack (the database and the PostgREST `crbn up`
// started); skipped without one.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { MissingAccountDefaultError } from "@carbon/database/journal-posting-status";
import { expect, it } from "vitest";
import { sql } from "kysely";
import { postReimbursementTransaction } from "../../app/modules/accounting/accounting.service";
import {
  payReimbursement,
  postPurchaseInvoice,
  postSalesInvoice
} from "../../app/modules/invoicing/invoicing.server";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";
import { reimbursementFixture } from "./fixtures/post-reimbursement";

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const localTest = (name: string, fn: () => Promise<void>) =>
  it.skipIf(!client)(name, fn, 60_000);

/** The operation's context, as the system on behalf of the test user. */
function contextOf(f: Pick<Fixture, "db" | "companyId" | "groupId">) {
  return createServiceContext({
    actor: { type: "system", onBehalfOf: USER },
    company: { id: f.companyId, groupId: f.groupId },
    caller: client!,
    system: () => client!,
    pg: () => f.db,
    kv: () => {
      throw new Error("No post operation reads the cache");
    }
  });
}

/** A sales invoice for one service line of 100, in `status`. */
async function salesInvoice(
  f: Fixture,
  key: string,
  options: {
    status?: "Draft" | "Pending";
    servicePeriod?: { start: string; end: string };
  } = {}
) {
  const invoiceId = `${f.prefix}-sales-invoice-${key}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("salesInvoice")
      .values({
        id: invoiceId,
        invoiceId: `INV-${key}`,
        customerId: f.customerId,
        currencyCode: "USD",
        exchangeRate: 1,
        status: options.status ?? "Draft",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesInvoiceShipment")
      .values({
        id: invoiceId,
        shippingCost: 0,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesInvoiceLine")
      .values({
        invoiceId,
        invoiceLineType: "Service",
        itemId: f.serviceId,
        quantity: 1,
        unitPrice: 100,
        exchangeRate: 1,
        unitOfMeasureCode: "EA",
        serviceStartDate: options.servicePeriod?.start ?? null,
        serviceEndDate: options.servicePeriod?.end ?? null,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return invoiceId;
}

function salesInvoiceRow(f: Fixture, invoiceId: string) {
  return f.db
    .selectFrom("salesInvoice")
    .select(["status", "postingDate", "sendError"])
    .where("id", "=", invoiceId)
    .executeTakeFirstOrThrow();
}

/** A purchase invoice with one G/L Account line of 60 on `accountId`. */
async function purchaseInvoice(
  f: Fixture,
  key: string,
  accountId: string,
  status: "Draft" | "Open" = "Draft"
) {
  const invoiceId = `${f.prefix}-purchase-invoice-${key}`;
  await seed(f, async (trx) => {
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseInvoice")
      .values({
        id: invoiceId,
        invoiceId: `PI-${key}`,
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        currencyCode: "USD",
        exchangeRate: 1,
        status,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("purchaseInvoiceDelivery")
      .values({ id: invoiceId, companyId: f.companyId })
      .execute();
    await trx
      .insertInto("purchaseInvoiceLine")
      .values({
        invoiceId,
        invoiceLineType: "G/L Account",
        accountId,
        quantity: 1,
        supplierUnitPrice: 60,
        exchangeRate: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return invoiceId;
}

async function purchaseInvoiceStatus(f: Fixture, invoiceId: string) {
  const row = await f.db
    .selectFrom("purchaseInvoice")
    .select("status")
    .where("id", "=", invoiceId)
    .executeTakeFirstOrThrow();
  return row.status;
}

localTest(
  "a sales invoice whose post fails goes back to Draft with the posting's refusal",
  async () => {
    const f = await alwaysPostFixture();
    try {
      // Its schedule rows need the deferred revenue default, which is empty.
      const invoiceId = await salesInvoice(f, "1", {
        servicePeriod: { start: f.cutoverDate, end: f.periodEnd }
      });

      const result = await postSalesInvoice(contextOf(f), { invoiceId });

      expect(result.error?.message).toBe(
        new MissingAccountDefaultError("deferredRevenueAccount").message
      );
      expect((await salesInvoiceRow(f, invoiceId)).status).toBe("Draft");
    } finally {
      await f.cleanup();
    }
  }
);

localTest(
  "a sales invoice that is no longer a Draft is refused and left as it is",
  async () => {
    const f = await alwaysPostFixture();
    try {
      // Pending is another post's claim: posting it again could post twice.
      const invoiceId = await salesInvoice(f, "1", { status: "Pending" });

      const result = await postSalesInvoice(contextOf(f), { invoiceId });

      expect(result.error?.category).toBe("conflict");
      expect(await salesInvoiceRow(f, invoiceId)).toMatchObject({
        status: "Pending",
        postingDate: null
      });
    } finally {
      await f.cleanup();
    }
  }
);

localTest(
  "a send that fails after the post keeps the invoice posted, stamps the error and warns",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const invoiceId = await salesInvoice(f, "1");

      const result = await postSalesInvoice(contextOf(f), {
        invoiceId,
        notification: "Email",
        // No such contact: the email cannot go out, whatever the PDF did.
        customerContact: `${f.prefix}-no-contact`
      });

      expect(result.error).toBeNull();
      expect(result.data).toMatchObject({ invoiceId, sentVia: "Email" });
      const warning =
        result.data && "warning" in result.data ? result.data.warning : null;
      expect(warning).toEqual(expect.any(String));
      const row = await salesInvoiceRow(f, invoiceId);
      expect(row.status).toBe("Submitted");
      expect(row.postingDate).toBe(f.today);
      expect(row.sendError).toEqual(expect.any(String));
    } finally {
      // The PDF the post filed, when it got that far.
      const filed = await f.db
        .deleteFrom("document")
        .where("companyId", "=", f.companyId)
        .returning("path")
        .execute();
      if (filed.length > 0) {
        await client!.storage
          .from(f.companyId)
          .remove(filed.map((document) => document.path));
      }
      await f.cleanup();
    }
  }
);

localTest(
  "a purchase invoice whose post fails goes back to Draft with the posting's refusal",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const groupAccountId = `${f.prefix}-group-account`;
      await seed(f, (trx) =>
        trx
          .insertInto("account")
          .values({
            id: groupAccountId,
            name: "group",
            class: "Expense",
            incomeBalance: "Income Statement",
            isGroup: true,
            companyGroupId: f.groupId,
            createdBy: USER
          })
          .execute()
      );
      const invoiceId = await purchaseInvoice(f, "1", groupAccountId);

      const result = await postPurchaseInvoice(contextOf(f), { invoiceId });

      expect(result.error?.message).toBe("Cannot post to a group account");
      expect(await purchaseInvoiceStatus(f, invoiceId)).toBe("Draft");
    } finally {
      await f.cleanup();
    }
  }
);

localTest(
  "a posted purchase invoice is refused and left posted",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const invoiceId = await purchaseInvoice(
        f,
        "1",
        f.account("supplies"),
        "Open"
      );

      const result = await postPurchaseInvoice(contextOf(f), { invoiceId });

      expect(result.error?.category).toBe("conflict");
      expect(await purchaseInvoiceStatus(f, invoiceId)).toBe("Open");
    } finally {
      await f.cleanup();
    }
  }
);

localTest(
  "a reimbursement payout whose post fails keeps the applied Draft payment and warns",
  async () => {
    const f = await reimbursementFixture();
    try {
      await postReimbursementTransaction(f.db, f.args);
      await f.db
        .insertInto("sequence")
        .values({
          table: "payment",
          name: "Payment",
          prefix: "PAY-",
          companyId: f.companyId
        })
        .execute();

      const result = await payReimbursement(contextOf(f), {
        reimbursementId: f.reimbursementId,
        amount: 620,
        paymentDate: "2026-09-12",
        // Not an Asset account: the post refuses it, after the application.
        bankAccount: f.account("expense")
      });

      expect(result.error).toBeNull();
      expect(result.data?.warning).toMatch(/Asset bank account/);
      const payment = await f.db
        .selectFrom("payment")
        .select(["status", "employeeId"])
        .where("id", "=", result.data!.paymentId)
        .executeTakeFirstOrThrow();
      expect(payment).toEqual({ status: "Draft", employeeId: f.employeeId });
      const applied = await f.db
        .selectFrom("invoiceSettlement")
        .select(["targetReimbursementId", "sourceAmount"])
        .where("paymentId", "=", result.data!.paymentId)
        .execute();
      expect(
        applied.map((row) => [row.targetReimbursementId, Number(row.sourceAmount)])
      ).toEqual([[f.reimbursementId, 620]]);
    } finally {
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .deleteFrom("invoiceSettlement")
          .where("companyId", "=", f.companyId)
          .execute();
        await trx
          .deleteFrom("payment")
          .where("companyId", "=", f.companyId)
          .execute();
      });
      await f.cleanup();
    }
  }
);
