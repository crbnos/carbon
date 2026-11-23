// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Payment requests through Ramp, against real Postgres. Only Ramp's HTTP API
// and the post-payment server function are substituted.
// Spec: .ai/specs/2026-11-23-supplier-payment-requests.md

import * as requests from "@carbon/database/payment-requests";
import { createMappingService } from "@carbon/ee/accounting";
import type {
  RampBill,
  RampBillPayment,
  RampClient
} from "@carbon/ee/ramp.server";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getJobDatabaseClient } from "../../../db";
import type { RampSyncContext } from "./ramp-sync-shared";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const hasLocalDatabase = (() => {
  try {
    return LOCAL_HOSTS.includes(
      new URL(process.env.SUPABASE_DB_URL ?? "").hostname
    );
  } catch {
    return false;
  }
})();

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@carbon/api/postings.server", () => ({
  posting: (_name: string, _handles: unknown, input: unknown) => post(input)
}));
vi.mock("@carbon/ee/ramp.server", async (original) => ({
  ...(await original<typeof import("@carbon/ee/ramp.server")>()),
  confirmSyncs: vi.fn()
}));

describe.skipIf(!hasLocalDatabase)("Ramp payment requests (Postgres)", () => {
  let db: ReturnType<typeof getJobDatabaseClient>;
  let mod: {
    push: typeof import("@carbon/ee/ramp.server")["pushReadyPaymentRequests"];
    syncBills: typeof import("./ramp-sync-bill")["syncRampBills"];
    syncPayment: typeof import("./ramp-sync-payment")["syncRampRequestPayment"];
    service: typeof import("@carbon/auth/client.server")["getCarbonServiceRole"];
  };
  let scope: {
    companyId: string;
    currencyCode: string;
    invoiceId: string;
    invoiceSupplierId: string;
    orderId: string;
    payablesAccount: string;
    prepaymentAccount: string;
    bankAccount: string;
  };
  const token = `t${Date.now()}`;
  const requestIds: string[] = [];
  const paymentIds: string[] = [];
  // The push sends every Ready request of the company: put the dev data back.
  let readyBefore: string[] = [];
  // Mappings the fixtures add, removed after: a leftover `account` mapping
  // makes the chart-of-accounts push skip that account at a real Ramp.
  const createdMappings: Array<{ entityType: string; entityId: string }> = [];

  const newRequest = async (
    target: { purchaseInvoiceId: string } | { purchaseOrderId: string },
    amount: number
  ) => {
    const number = await db
      .selectFrom("paymentRequest")
      .select((eb) => eb.fn.max("requestNumber").as("n"))
      .where("companyId", "=", scope.companyId)
      .where(
        "purchaseInvoiceId" in target ? "purchaseInvoiceId" : "purchaseOrderId",
        "=",
        "purchaseInvoiceId" in target
          ? target.purchaseInvoiceId
          : target.purchaseOrderId
      )
      .executeTakeFirst();
    const row = await db
      .insertInto("paymentRequest")
      .values({
        companyId: scope.companyId,
        ...target,
        requestNumber: Number(number?.n ?? 0) + 1,
        status: "Ready",
        amount,
        currencyCode: scope.currencyCode,
        dueDate: "2026-12-01",
        createdBy: "system"
      })
      .returning(["id", "requestNumber"])
      .executeTakeFirstOrThrow();
    requestIds.push(row.id);
    return row;
  };

  const statusOf = async (id: string) =>
    await db
      .selectFrom("paymentRequest")
      .select(["status", "paymentId"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();

  /** `found` maps a request id to the bill Ramp already holds for it. */
  const fakeRamp = (found: Record<string, string> = {}) => {
    const created: unknown[] = [];
    let n = 0;
    const ramp = {
      findBillIdByRemoteId: vi.fn(async (id: string) => found[id] ?? null),
      createDraftBill: vi.fn(async (body: unknown) => {
        created.push(body);
        return { id: `${token}-draft-${++n}` };
      })
    } as unknown as RampClient;
    return { ramp, created };
  };

  const deps = () => ({
    companyId: scope.companyId,
    baseCurrency: scope.currencyCode,
    statementBankAccountId: scope.bankAccount,
    card: { error: "no card" },
    db,
    client: mod.service(),
    getMappedInvoiceId: async () => null,
    normalizeAmount: async (value: unknown) => ({
      ok: true as const,
      value: (value as { amount: number }).amount / 100
    }),
    getExchangeRate: async () => 1,
    invoiceDeepLinkUrl: (id: string) => id,
    purchaseOrderDeepLinkUrl: (id: string) => id
  });

  const rampPayment = (amountMinor: number): RampBillPayment =>
    ({
      id: `${token}-pay-${amountMinor}-${Math.random()}`,
      amount: { amount: amountMinor, currency_code: scope.currencyCode },
      payment_method: "ACH",
      payment_date: "2026-12-01"
    }) as RampBillPayment;

  beforeAll(async () => {
    db = getJobDatabaseClient();
    const [ee, bills, payments, auth] = await Promise.all([
      import("@carbon/ee/ramp.server"),
      import("./ramp-sync-bill"),
      import("./ramp-sync-payment"),
      import("@carbon/auth/client.server")
    ]);
    mod = {
      push: ee.pushReadyPaymentRequests,
      syncBills: bills.syncRampBills,
      syncPayment: payments.syncRampRequestPayment,
      service: auth.getCarbonServiceRole
    };
    const invoice = await db
      .selectFrom("purchaseInvoices as pi")
      .innerJoin("company as c", "c.id", "pi.companyId")
      .innerJoin("accountDefault as ad", "ad.companyId", "pi.companyId")
      .select([
        "pi.companyId",
        "c.baseCurrencyCode as currencyCode",
        "pi.id as invoiceId",
        "pi.supplierId as invoiceSupplierId",
        "ad.payablesAccount",
        "ad.supplierPrepaymentAccount as prepaymentAccount",
        "ad.bankCashAccount as bankAccount"
      ])
      .where("pi.status", "in", ["Open", "Overdue", "Partially Paid"])
      .where("pi.balance", ">", 100)
      // The most room left: the rules tests need an allowance to spend.
      .orderBy(
        (eb) =>
          eb(
            "pi.balance",
            "-",
            eb
              .selectFrom("paymentRequest as r")
              .select(sql<number>`COALESCE(SUM(r."amount"), 0)`.as("n"))
              .whereRef("r.purchaseInvoiceId", "=", "pi.id")
              .where("r.status", "in", ["Planned", "Ready", "Sent"])
          ),
        "desc"
      )
      .where((eb) => eb("pi.currencyCode", "=", eb.ref("c.baseCurrencyCode")))
      .limit(1)
      .executeTakeFirstOrThrow();
    const order = await db
      .selectFrom("purchaseOrders")
      .select("id")
      .where("companyId", "=", invoice.companyId!)
      .where("status", "=", "To Receive")
      .where("orderTotal", ">", 100)
      .limit(1)
      .executeTakeFirstOrThrow();
    scope = {
      ...(invoice as Omit<typeof scope, "orderId">),
      orderId: order.id!
    };
    // The supplier already has a Ramp vendor and the accounts are Ramp options.
    const mapping = createMappingService(db, scope.companyId);
    const orderSupplier = await db
      .selectFrom("purchaseOrder")
      .select("supplierId")
      .where("id", "=", scope.orderId)
      .executeTakeFirstOrThrow();
    for (const supplierId of new Set([
      scope.invoiceSupplierId,
      orderSupplier.supplierId
    ])) {
      if (!(await mapping.getExternalId("vendor", supplierId, "ramp"))) {
        await mapping.link(
          "vendor",
          supplierId,
          "ramp",
          `${token}-vendor-${supplierId}`
        );
        createdMappings.push({ entityType: "vendor", entityId: supplierId });
      }
    }
    for (const accountId of [scope.payablesAccount, scope.prepaymentAccount]) {
      if (!(await mapping.getExternalId("account", accountId, "ramp"))) {
        await mapping.link("account", accountId, "ramp", accountId);
        createdMappings.push({ entityType: "account", entityId: accountId });
      }
    }
    readyBefore = (
      await db
        .selectFrom("paymentRequest")
        .select("id")
        .where("companyId", "=", scope.companyId)
        .where("status", "=", "Ready")
        .execute()
    ).map((row) => row.id);
    // post-payment: what the tests need of it is the Posted status.
    post.mockImplementation(async (input: { paymentId: string }) => {
      paymentIds.push(input.paymentId);
      await db
        .updateTable("payment")
        .set({ status: "Posted" })
        .where("id", "=", input.paymentId)
        .execute();
      return { data: null, error: null };
    });
  }, 30000);

  afterAll(async () => {
    if (!db) return;
    await db
      .updateTable("paymentRequest")
      .set({ status: "Ready" })
      .where("id", "in", [...readyBefore, ""])
      .execute();
    await db
      .updateTable("paymentRequest")
      .set({ status: "Cancelled", paymentId: null })
      .where("id", "in", [...requestIds, ""])
      .execute();
    await db
      .deleteFrom("paymentRequest")
      .where("id", "in", [...requestIds, ""])
      .execute();
    await db
      .deleteFrom("externalIntegrationMapping")
      .where("integration", "=", "ramp")
      .where((eb) =>
        eb.or([
          eb("entityId", "in", [
            ...requestIds,
            ...paymentIds,
            ...readyBefore,
            ""
          ]),
          eb("externalId", "like", `${token}%`)
        ])
      )
      .execute();
    for (const created of createdMappings) {
      await createMappingService(db, scope.companyId).unlink(
        created.entityType,
        created.entityId,
        "ramp"
      );
    }
    // Posted payments are guarded by triggers; the fixtures go around them.
    await db.transaction().execute(async (tx) => {
      await sql`SET LOCAL session_replication_role = replica`.execute(tx);
      await tx
        .deleteFrom("invoiceSettlement")
        .where("paymentId", "in", [...paymentIds, ""])
        .execute();
      await tx
        .deleteFrom("payment")
        .where("id", "in", [...paymentIds, ""])
        .execute();
    });
  });

  it("sends a Ready request as one coded draft bill and marks it Sent", async () => {
    const request = await newRequest(
      { purchaseInvoiceId: scope.invoiceId },
      20
    );
    const { ramp, created } = fakeRamp();
    const result = await mod.push({
      db,
      ramp,
      companyId: scope.companyId,
      userId: "system"
    });

    expect(result.failed.filter((f) => f.id === request.id)).toEqual([]);
    const body = created.find(
      (b) => (b as { remote_id: string }).remote_id === request.id
    ) as Record<string, any>;
    expect(body.invoice_number).toMatch(
      new RegExp(`-R${request.requestNumber}$`)
    );
    expect(body.line_items).toEqual([
      expect.objectContaining({
        amount: 20,
        accounting_field_selections: [
          expect.objectContaining({
            field_option_external_id: scope.payablesAccount
          })
        ]
      })
    ]);
    expect((await statusOf(request.id)).status).toBe("Sent");

    // A second run has nothing Ready for this request: no second bill.
    const again = fakeRamp();
    await mod.push({
      db,
      ramp: again.ramp,
      companyId: scope.companyId,
      userId: "system"
    });
    expect(
      again.created.some(
        (b) => (b as { remote_id: string }).remote_id === request.id
      )
    ).toBe(false);
  }, 30000);

  it("adopts the bill Ramp already has instead of creating a second one", async () => {
    // A run created the draft and stopped before saving Sent.
    const request = await newRequest({ purchaseOrderId: scope.orderId }, 15);
    const { ramp, created } = fakeRamp({ [request.id]: `${token}-existing` });
    await mod.push({ db, ramp, companyId: scope.companyId, userId: "system" });

    expect(
      created.some((b) => (b as { remote_id: string }).remote_id === request.id)
    ).toBe(false);
    expect((await statusOf(request.id)).status).toBe("Sent");
    const mapped = await createMappingService(
      db,
      scope.companyId
    ).getExternalId("paymentRequest", request.id, "ramp");
    expect(mapped).toBe(`${token}-existing`);
  }, 30000);

  it("confirms a request's Ramp bill without creating an invoice", async () => {
    const request = await newRequest(
      { purchaseInvoiceId: scope.invoiceId },
      10
    );
    const bill = {
      id: `${token}-bill-1`,
      remote_id: request.id,
      invoice_number: `${token}-R1`,
      amount: { amount: 1000, currency_code: scope.currencyCode },
      vendor: { name: "Anyone" }
    } as unknown as RampBill;
    const ramp = {
      async *listBills() {
        yield [bill];
      }
    } as unknown as RampClient;
    const ctx = {
      client: mod.service(),
      db,
      companyId: scope.companyId,
      baseCurrency: scope.currencyCode,
      mapping: createMappingService(db, scope.companyId),
      decimalsCache: new Map(),
      exchangeRateCache: new Map(),
      createdBy: "system",
      trigger: "event",
      metadata: { sync: { pullBills: true } }
    } as unknown as RampSyncContext;

    const result = await mod.syncBills(ctx, ramp, undefined);

    expect(result).toMatchObject({ failed: 0, reconfirmed: 1, created: 0 });
    const invoices = await db
      .selectFrom("purchaseInvoice")
      .select("id")
      .where("companyId", "=", scope.companyId)
      .where("supplierReference", "=", `${token}-R1`)
      .execute();
    expect(invoices).toEqual([]);
  }, 30000);

  it("applies an invoice request's payment to the invoice once", async () => {
    const request = await newRequest(
      { purchaseInvoiceId: scope.invoiceId },
      12.5
    );
    const row = await db
      .selectFrom("paymentRequest")
      .selectAll()
      .where("id", "=", request.id)
      .executeTakeFirstOrThrow();
    const bill = { id: `${token}-bill-2`, remote_id: request.id } as RampBill;
    const payment = rampPayment(1250);

    const first = await mod.syncPayment(deps(), bill, payment, row);
    expect(first).toHaveProperty("ok");
    const paid = await statusOf(request.id);
    expect(paid.status).toBe("Paid");
    const settlement = await db
      .selectFrom("invoiceSettlement")
      .select(["targetPurchaseInvoiceId", "appliedAmount"])
      .where("paymentId", "=", paid.paymentId!)
      .executeTakeFirstOrThrow();
    expect(settlement.targetPurchaseInvoiceId).toBe(scope.invoiceId);

    // The same Ramp payment again: no second payment, the request unchanged.
    const second = await mod.syncPayment(deps(), bill, payment, {
      ...row,
      status: "Paid",
      paymentId: paid.paymentId
    });
    expect(second).toHaveProperty("ok");
    expect((await statusOf(request.id)).paymentId).toBe(paid.paymentId);
    const count = await db
      .selectFrom("externalIntegrationMapping")
      .select((eb) => eb.fn.countAll().as("n"))
      .where("integration", "=", "ramp")
      .where("entityType", "=", "payment")
      .where("externalId", "=", payment.id!)
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(1);
  }, 30000);

  it("records a deposit request's payment as a prepayment on its order and warns on a different amount", async () => {
    const request = await newRequest({ purchaseOrderId: scope.orderId }, 40);
    const row = await db
      .selectFrom("paymentRequest")
      .selectAll()
      .where("id", "=", request.id)
      .executeTakeFirstOrThrow();
    const result = await mod.syncPayment(
      deps(),
      { id: `${token}-bill-3`, remote_id: request.id } as RampBill,
      rampPayment(3900),
      row
    );

    expect(result).toHaveProperty("ok");
    expect(result.warning?.id).toBe(request.id);
    const paid = await statusOf(request.id);
    expect(paid.status).toBe("Paid");
    const prepayment = await db
      .selectFrom("payment")
      .select(["purchaseOrderId", "totalAmount", "status", "paymentType"])
      .where("id", "=", paid.paymentId!)
      .executeTakeFirstOrThrow();
    expect(prepayment).toMatchObject({
      purchaseOrderId: scope.orderId,
      status: "Posted",
      paymentType: "Disbursement"
    });
    expect(Number(prepayment.totalAmount)).toBe(39);
  }, 30000);

  it("applies a payment for a request cancelled after it was sent", async () => {
    const request = await newRequest({ purchaseInvoiceId: scope.invoiceId }, 5);
    await db
      .updateTable("paymentRequest")
      .set({ status: "Cancelled" })
      .where("id", "=", request.id)
      .execute();
    const row = await db
      .selectFrom("paymentRequest")
      .selectAll()
      .where("id", "=", request.id)
      .executeTakeFirstOrThrow();
    const result = await mod.syncPayment(
      deps(),
      { id: `${token}-bill-4`, remote_id: request.id } as RampBill,
      rampPayment(500),
      row
    );
    expect(result).toHaveProperty("ok");
    expect((await statusOf(request.id)).status).toBe("Paid");
  }, 30000);

  describe("request rules", () => {
    const actor = () => ({ companyId: scope.companyId, userId: "system" });
    const refusal = (p: Promise<unknown>) =>
      expect(p).rejects.toBeInstanceOf(requests.PaymentRequestRefusal);

    it("re-checks the allowance and the fields when a request is marked Ready", async () => {
      const allowance = await requests.getRequestAllowance(db, {
        companyId: scope.companyId,
        target: { purchaseInvoiceId: scope.invoiceId }
      });
      const planned = await newRequest(
        { purchaseInvoiceId: scope.invoiceId },
        1
      );
      await db
        .updateTable("paymentRequest")
        .set({ status: "Planned", amount: allowance.allowance + 100 })
        .where("id", "=", planned.id)
        .execute();
      await refusal(
        requests.markPaymentRequestReady(db, {
          ...actor(),
          requestId: planned.id
        })
      );
      await db
        .updateTable("paymentRequest")
        .set({ amount: null, dueDate: null })
        .where("id", "=", planned.id)
        .execute();
      await refusal(
        requests.markPaymentRequestReady(db, {
          ...actor(),
          requestId: planned.id
        })
      );
      expect((await statusOf(planned.id)).status).toBe("Planned");
    }, 30000);

    it("keeps the fields a partial update leaves out", async () => {
      const request = await newRequest(
        { purchaseInvoiceId: scope.invoiceId },
        3
      );
      const updated = await requests.updatePaymentRequest(db, {
        ...actor(),
        requestId: request.id,
        status: "Planned",
        description: "per vendor email"
      });
      expect(Number(updated.amount)).toBe(3);
      expect(String(updated.dueDate).slice(0, 10)).toBe("2026-12-01");
      expect(updated.description).toBe("per vendor email");
    }, 30000);

    it("refuses to edit or move back a request Ramp already holds", async () => {
      const request = await newRequest(
        { purchaseInvoiceId: scope.invoiceId },
        4
      );
      await createMappingService(db, scope.companyId).link(
        requests.PAYMENT_REQUEST_MAPPING_ENTITY,
        request.id,
        "ramp",
        `${token}-held-${request.id}`
      );
      await refusal(
        requests.markPaymentRequestPlanned(db, {
          ...actor(),
          requestId: request.id
        })
      );
      await refusal(
        requests.updatePaymentRequest(db, {
          ...actor(),
          requestId: request.id,
          status: "Ready",
          amount: 2
        })
      );
    }, 30000);

    it("returns a request to Planned when its payment is released", async () => {
      const request = await newRequest(
        { purchaseInvoiceId: scope.invoiceId },
        2
      );
      const row = await db
        .selectFrom("paymentRequest")
        .selectAll()
        .where("id", "=", request.id)
        .executeTakeFirstOrThrow();
      await mod.syncPayment(
        deps(),
        { id: `${token}-bill-5`, remote_id: request.id } as RampBill,
        rampPayment(200),
        row
      );
      const paid = await statusOf(request.id);
      expect(paid.status).toBe("Paid");
      await requests.releasePaymentRequestsOfPayment(db, {
        ...actor(),
        paymentId: paid.paymentId!
      });
      expect(await statusOf(request.id)).toMatchObject({
        status: "Planned",
        paymentId: null
      });
    }, 30000);
  });
});
