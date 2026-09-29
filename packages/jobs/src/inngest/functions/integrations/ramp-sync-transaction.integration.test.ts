import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getJobDatabaseClient } from "../../../db";
import { stageRampPaymentDraft } from "./ramp-sync-payment";

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
            token.replace("RAMP-REIMB-", ""),
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

    /**
     * A minimal Draft purchase invoice to settle a payment against. It used to
     * come from the Ramp reimbursement stager; reimbursements are their own
     * document now (`ramp-sync-reimbursement-create.integration.test.ts`), and
     * these payment tests only ever needed an invoice id.
     */
    async function stageInvoice(
      token: string
    ): Promise<{ invoiceRowId: string }> {
      const interaction = await db
        .insertInto("supplierInteraction")
        .values({
          companyId: fixture.companyId,
          supplierId: fixture.supplierId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const invoice = await db
        .insertInto("purchaseInvoice")
        .values({
          invoiceId: `PINV-TEST-${crypto.randomUUID()}`,
          status: "Draft",
          supplierId: fixture.supplierId,
          supplierReference: token,
          currencyCode: fixture.currencyCode,
          exchangeRate: 1.25,
          dateIssued: "2026-09-10",
          dateDue: "2026-09-11",
          supplierInteractionId: interaction.id,
          companyId: fixture.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await db
        .insertInto("purchaseInvoiceDelivery")
        .values({
          id: invoice.id,
          companyId: fixture.companyId,
          supplierShippingCost: 0
        })
        .execute();
      await db
        .insertInto("purchaseInvoiceLine")
        .values({
          invoiceId: invoice.id,
          invoiceLineType: "G/L Account",
          accountId: fixture.accountId,
          description: "Ramp integration test",
          quantity: 1,
          supplierUnitPrice: 100,
          exchangeRate: 1.25,
          companyId: fixture.companyId,
          createdBy: fixture.actorId
        })
        .execute();
      // `upsertLocalPaymentDraft` resolves the settled document through its Ramp
      // mapping, so the invoice must be anchored to the token the payment cites.
      await db
        .insertInto("externalIntegrationMapping")
        .values({
          entityType: "bill",
          entityId: invoice.id,
          integration: "ramp",
          externalId: token,
          companyId: fixture.companyId,
          createdBy: fixture.actorId
        })
        .execute();
      return { invoiceRowId: invoice.id };
    }

    it("resumes a real mapped Draft payment without changing its FX snapshot", async () => {
      const token = `RAMP-REIMB-TEST-${crypto.randomUUID()}`;
      tokens.push(token);
      const invoice = await stageInvoice(token);
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
      await stageInvoice(token);
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
