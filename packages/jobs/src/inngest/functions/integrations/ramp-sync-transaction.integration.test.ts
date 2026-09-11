import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getJobDatabaseClient } from "../../../db";
import { stageRampPaymentDraft } from "./ramp-sync-payment";
import { stageOrResumeRampReimbursementInvoice } from "./ramp-sync-reimbursement";

const runDatabaseTests = process.env.RUN_RAMP_DB_TESTS === "true";

describe.skipIf(!runDatabaseTests)(
  "Ramp transactional staging (Postgres)",
  () => {
    let db: Kysely<KyselyDatabase>;
    const tokens: string[] = [];
    let fixture: {
      companyId: string;
      currencyCode: string;
      actorId: string;
      bankAccount: string;
      supplierId: string;
      accountId: string;
    };

    beforeAll(async () => {
      db = getJobDatabaseClient(2);
      const row = await db
        .selectFrom("company")
        .innerJoin(
          "currency",
          "currency.companyGroupId",
          "company.companyGroupId"
        )
        .innerJoin("accountDefault", "accountDefault.companyId", "company.id")
        .innerJoin("supplier", "supplier.companyId", "company.id")
        .innerJoin(
          "account",
          "account.companyGroupId",
          "company.companyGroupId"
        )
        .innerJoin("employeeJob", "employeeJob.companyId", "company.id")
        .innerJoin("user", "user.id", "employeeJob.id")
        .select([
          "company.id as companyId",
          "currency.code as currencyCode",
          "employeeJob.id as actorId",
          "accountDefault.bankCashAccount",
          "supplier.id as supplierId",
          "account.id as accountId"
        ])
        .whereRef("currency.code", "!=", "company.baseCurrencyCode")
        .where("accountDefault.bankCashAccount", "is not", null)
        .where("account.class", "=", "Expense")
        .where("user.active", "=", true)
        .limit(1)
        .executeTakeFirstOrThrow();
      if (!row.bankCashAccount)
        throw new Error("Fixture bank account is missing");
      fixture = { ...row, bankAccount: row.bankCashAccount };
    });

    afterAll(async () => {
      for (const token of tokens) {
        const invoices = await db
          .selectFrom("purchaseInvoice")
          .select(["id", "supplierInteractionId"])
          .where("companyId", "=", fixture.companyId)
          .where("supplierReference", "=", token)
          .execute();
        const invoiceIds = invoices.map((row) => row.id);
        const interactionIds = invoices.map((row) => row.supplierInteractionId);
        await db
          .deleteFrom("externalIntegrationMapping")
          .where("companyId", "=", fixture.companyId)
          .where("externalId", "in", [
            token,
            `${token}:payment`,
            `${token}:broken`
          ])
          .execute();
        const payments = await db
          .selectFrom("payment")
          .select("id")
          .where("companyId", "=", fixture.companyId)
          .where("reference", "like", `${token}%`)
          .execute();
        if (payments.length > 0) {
          await db
            .deleteFrom("invoiceSettlement")
            .where("companyId", "=", fixture.companyId)
            .where(
              "paymentId",
              "in",
              payments.map((row) => row.id)
            )
            .execute();
          await db
            .deleteFrom("payment")
            .where("companyId", "=", fixture.companyId)
            .where(
              "id",
              "in",
              payments.map((row) => row.id)
            )
            .execute();
        }
        if (invoiceIds.length > 0) {
          await db
            .deleteFrom("purchaseInvoice")
            .where("companyId", "=", fixture.companyId)
            .where("id", "in", invoiceIds)
            .execute();
        }
        if (interactionIds.length > 0) {
          await db
            .deleteFrom("supplierInteraction")
            .where("companyId", "=", fixture.companyId)
            .where("id", "in", interactionIds)
            .execute();
        }
      }
    });

    function invoiceArgs(token: string, accountId = fixture.accountId) {
      return {
        companyId: fixture.companyId,
        actorId: fixture.actorId,
        reimbursementRemoteId: token,
        supplierId: fixture.supplierId,
        supplierReference: token,
        currencyCode: fixture.currencyCode,
        exchangeRate: 1.25,
        dateIssued: "2026-09-10",
        dateDue: "2026-09-11",
        lines: [
          {
            accountId,
            costCenterId: null,
            amount: 100,
            description: "Ramp integration test"
          }
        ]
      };
    }

    it("atomically creates and then resumes one mapped reimbursement Draft", async () => {
      const token = `RAMP-REIMB-TEST-${crypto.randomUUID()}`;
      tokens.push(token);
      const first = await stageOrResumeRampReimbursementInvoice(
        db,
        invoiceArgs(token)
      );
      const retried = await stageOrResumeRampReimbursementInvoice(
        db,
        invoiceArgs(token)
      );

      expect(retried.invoiceRowId).toBe(first.invoiceRowId);
      expect(retried.created).toBe(false);
      const [headers, deliveries, lines, mappings] = await Promise.all([
        db
          .selectFrom("purchaseInvoice")
          .select("id")
          .where("companyId", "=", fixture.companyId)
          .where("supplierReference", "=", token)
          .execute(),
        db
          .selectFrom("purchaseInvoiceDelivery")
          .select("id")
          .where("companyId", "=", fixture.companyId)
          .where("id", "=", first.invoiceRowId)
          .execute(),
        db
          .selectFrom("purchaseInvoiceLine")
          .select("id")
          .where("companyId", "=", fixture.companyId)
          .where("invoiceId", "=", first.invoiceRowId)
          .execute(),
        db
          .selectFrom("externalIntegrationMapping")
          .select("id")
          .where("companyId", "=", fixture.companyId)
          .where("integration", "=", "ramp")
          .where("entityType", "=", "bill")
          .where("externalId", "=", token)
          .execute()
      ]);
      expect([
        headers.length,
        deliveries.length,
        lines.length,
        mappings.length
      ]).toEqual([1, 1, 1, 1]);
    });

    it("serializes concurrent staging on the tenant-scoped reimbursement key", async () => {
      const token = `RAMP-REIMB-TEST-${crypto.randomUUID()}`;
      tokens.push(token);

      const [first, second] = await Promise.all([
        stageOrResumeRampReimbursementInvoice(db, invoiceArgs(token)),
        stageOrResumeRampReimbursementInvoice(db, invoiceArgs(token))
      ]);

      expect(second.invoiceRowId).toBe(first.invoiceRowId);
      expect([first.created, second.created].sort()).toEqual([false, true]);
      const [headers, mappings] = await Promise.all([
        db
          .selectFrom("purchaseInvoice")
          .select("id")
          .where("companyId", "=", fixture.companyId)
          .where("supplierReference", "=", token)
          .execute(),
        db
          .selectFrom("externalIntegrationMapping")
          .select("id")
          .where("companyId", "=", fixture.companyId)
          .where("integration", "=", "ramp")
          .where("entityType", "=", "bill")
          .where("externalId", "=", token)
          .execute()
      ]);
      expect(headers).toHaveLength(1);
      expect(mappings).toHaveLength(1);
    });

    it("adopts a complete untracked legacy reimbursement Draft after a pre-mapping crash", async () => {
      const token = `RAMP-REIMB-TEST-${crypto.randomUUID()}`;
      tokens.push(token);
      const interaction = await db
        .insertInto("supplierInteraction")
        .values({
          companyId: fixture.companyId,
          supplierId: fixture.supplierId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const legacy = await db
        .insertInto("purchaseInvoice")
        .values({
          invoiceId: `PINV-LEGACY-${crypto.randomUUID()}`,
          status: "Draft",
          supplierId: fixture.supplierId,
          supplierReference: token,
          currencyCode: fixture.currencyCode,
          exchangeRate: 1.25,
          supplierInteractionId: interaction.id,
          companyId: fixture.companyId,
          createdBy: fixture.actorId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await db
        .insertInto("purchaseInvoiceDelivery")
        .values({
          id: legacy.id,
          companyId: fixture.companyId,
          supplierShippingCost: 0
        })
        .execute();
      await db
        .insertInto("purchaseInvoiceLine")
        .values({
          invoiceId: legacy.id,
          invoiceLineType: "G/L Account",
          accountId: fixture.accountId,
          quantity: 1,
          supplierUnitPrice: 100,
          exchangeRate: 1.25,
          companyId: fixture.companyId,
          createdBy: fixture.actorId
        })
        .execute();

      const resumed = await stageOrResumeRampReimbursementInvoice(db, {
        ...invoiceArgs(token),
        exchangeRate: 2
      });

      expect(resumed).toMatchObject({
        invoiceRowId: legacy.id,
        exchangeRate: 1.25,
        created: false
      });
      const mapping = await db
        .selectFrom("externalIntegrationMapping")
        .select("entityId")
        .where("companyId", "=", fixture.companyId)
        .where("integration", "=", "ramp")
        .where("entityType", "=", "bill")
        .where("externalId", "=", token)
        .executeTakeFirstOrThrow();
      expect(mapping.entityId).toBe(legacy.id);
      const line = await db
        .selectFrom("purchaseInvoiceLine")
        .select("exchangeRate")
        .where("companyId", "=", fixture.companyId)
        .where("invoiceId", "=", legacy.id)
        .executeTakeFirstOrThrow();
      expect(line.exchangeRate).toBe(1.25);
    });

    it("rolls back interaction, header, delivery, and mapping on a mid-write line failure", async () => {
      const token = `RAMP-REIMB-TEST-${crypto.randomUUID()}`;
      tokens.push(token);
      const before = await db
        .selectFrom("supplierInteraction")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("companyId", "=", fixture.companyId)
        .where("supplierId", "=", fixture.supplierId)
        .executeTakeFirstOrThrow();

      await expect(
        stageOrResumeRampReimbursementInvoice(
          db,
          invoiceArgs(token, `acct_missing_${crypto.randomUUID()}`)
        )
      ).rejects.toThrow();

      const [after, headers, mappings] = await Promise.all([
        db
          .selectFrom("supplierInteraction")
          .select(({ fn }) => fn.countAll<number>().as("count"))
          .where("companyId", "=", fixture.companyId)
          .where("supplierId", "=", fixture.supplierId)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom("purchaseInvoice")
          .select("id")
          .where("companyId", "=", fixture.companyId)
          .where("supplierReference", "=", token)
          .execute(),
        db
          .selectFrom("externalIntegrationMapping")
          .select("id")
          .where("companyId", "=", fixture.companyId)
          .where("externalId", "=", token)
          .execute()
      ]);
      expect(Number(after.count)).toBe(Number(before.count));
      expect(headers).toEqual([]);
      expect(mappings).toEqual([]);
    });

    it("resumes a real mapped Draft payment without changing its FX snapshot", async () => {
      const token = `RAMP-REIMB-TEST-${crypto.randomUUID()}`;
      tokens.push(token);
      const invoice = await stageOrResumeRampReimbursementInvoice(
        db,
        invoiceArgs(token)
      );
      const paymentId = `pay_test_${crypto.randomUUID()}`;
      await db.transaction().execute(async (tx) => {
        await tx
          .insertInto("payment")
          .values({
            id: paymentId,
            paymentId: `PAY-TEST-${token.slice(-8)}`,
            paymentType: "Disbursement",
            status: "Draft",
            supplierId: fixture.supplierId,
            paymentDate: "2026-09-11",
            postingDate: "2026-09-11",
            currencyCode: fixture.currencyCode,
            exchangeRate: 1.1,
            totalAmount: 50,
            bankAccount: fixture.bankAccount,
            reference: `${token}:payment`,
            companyId: fixture.companyId,
            createdBy: fixture.actorId
          })
          .execute();
        await tx
          .insertInto("invoiceSettlement")
          .values({
            paymentId,
            targetPurchaseInvoiceId: invoice.invoiceRowId,
            appliedAmount: 40,
            sourceAmount: 50,
            sourceExchangeRate: 1.1,
            targetExchangeRate: 1.25,
            appliedDate: "2026-09-11",
            companyId: fixture.companyId,
            createdBy: fixture.actorId
          })
          .execute();
        await tx
          .insertInto("externalIntegrationMapping")
          .values({
            entityType: "payment",
            entityId: paymentId,
            integration: "ramp",
            externalId: `${token}:payment`,
            companyId: fixture.companyId,
            createdBy: fixture.actorId
          })
          .execute();
      });

      const result = await stageRampPaymentDraft(db, {
        companyId: fixture.companyId,
        actorId: fixture.actorId,
        bankAccount: fixture.bankAccount,
        paymentMappingId: `${token}:payment`,
        normalized: {
          family: "ap",
          documentRemoteId: token,
          paymentRemoteId: `${token}:payment`,
          amount: 100,
          currencyCode: fixture.currencyCode,
          exchangeRate: 1.2,
          paidDate: "2026-09-11",
          reference: `${token}:payment`,
          status: "settled"
        }
      });

      expect(result).toEqual({ paymentRowId: paymentId, postAction: "post" });
      const [payment, settlements, mappings] = await Promise.all([
        db
          .selectFrom("payment")
          .select(["exchangeRate", "totalAmount"])
          .where("id", "=", paymentId)
          .where("companyId", "=", fixture.companyId)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom("invoiceSettlement")
          .select(["sourceExchangeRate", "targetExchangeRate", "sourceAmount"])
          .where("paymentId", "=", paymentId)
          .where("companyId", "=", fixture.companyId)
          .execute(),
        db
          .selectFrom("externalIntegrationMapping")
          .select("id")
          .where("externalId", "=", `${token}:payment`)
          .where("companyId", "=", fixture.companyId)
          .execute()
      ]);
      expect(payment).toEqual({ exchangeRate: 1.1, totalAmount: 100 });
      expect(settlements).toEqual([
        { sourceExchangeRate: 1.1, targetExchangeRate: 1.25, sourceAmount: 100 }
      ]);
      expect(mappings).toHaveLength(1);
    });

    it("rolls back a newly inserted payment when its mapping write conflicts", async () => {
      const token = `RAMP-REIMB-TEST-${crypto.randomUUID()}`;
      tokens.push(token);
      await stageOrResumeRampReimbursementInvoice(db, invoiceArgs(token));
      await db
        .insertInto("externalIntegrationMapping")
        .values({
          entityType: "payment",
          entityId: `pay_missing_${crypto.randomUUID()}`,
          integration: "ramp",
          externalId: `${token}:broken`,
          companyId: fixture.companyId,
          createdBy: fixture.actorId
        })
        .execute();

      await expect(
        stageRampPaymentDraft(db, {
          companyId: fixture.companyId,
          actorId: fixture.actorId,
          bankAccount: fixture.bankAccount,
          paymentMappingId: `${token}:broken`,
          normalized: {
            family: "ap",
            documentRemoteId: token,
            paymentRemoteId: `${token}:broken`,
            amount: 100,
            currencyCode: fixture.currencyCode,
            exchangeRate: 1.2,
            paidDate: "2026-09-11",
            reference: `${token}:rollback`,
            status: "settled"
          }
        })
      ).rejects.toThrow();

      const payments = await db
        .selectFrom("payment")
        .select("id")
        .where("companyId", "=", fixture.companyId)
        .where("reference", "=", `${token}:rollback`)
        .execute();
      expect(payments).toEqual([]);
    });
  }
);
