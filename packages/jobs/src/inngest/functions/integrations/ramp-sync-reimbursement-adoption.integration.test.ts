import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getJobDatabaseClient } from "../../../db";
import { stageOrResumeRampReimbursementInvoice } from "./ramp-sync-reimbursement";

describe.skipIf(process.env.RUN_RAMP_DB_TESTS !== "true")(
  "Ramp reimbursement legacy adoption (Postgres)",
  () => {
    let db: Kysely<KyselyDatabase>;
    let scope: { companyId: string; currencyCode: string; accountId: string };
    const supplierIds: string[] = [];

    beforeAll(async () => {
      db = getJobDatabaseClient(2);
      const row = await db
        .selectFrom("company")
        .innerJoin(
          "account",
          "account.companyGroupId",
          "company.companyGroupId"
        )
        .select([
          "company.id as companyId",
          "company.baseCurrencyCode as currencyCode",
          "account.id as accountId"
        ])
        .where("account.class", "=", "Expense")
        .where("account.active", "=", true)
        .where("account.isGroup", "=", false)
        .limit(1)
        .executeTakeFirstOrThrow();
      if (!row.currencyCode) throw new Error("Fixture currency missing");
      scope = { ...row, currencyCode: row.currencyCode };
    });

    afterAll(async () => {
      if (!scope || !supplierIds.length) return;
      const invoices = await db
        .selectFrom("purchaseInvoice")
        .select("id")
        .where("companyId", "=", scope.companyId)
        .where("supplierId", "in", supplierIds)
        .execute();
      if (invoices.length) {
        await db
          .deleteFrom("externalIntegrationMapping")
          .where("companyId", "=", scope.companyId)
          .where("integration", "=", "ramp")
          .where(
            "entityId",
            "in",
            invoices.map((row) => row.id)
          )
          .execute();
        // No edge posts run here: status-only fixtures can safely return to Draft.
        await db
          .updateTable("purchaseInvoice")
          .set({ status: "Draft" })
          .where("companyId", "=", scope.companyId)
          .where("supplierId", "in", supplierIds)
          .execute();
        await db
          .deleteFrom("purchaseInvoice")
          .where("companyId", "=", scope.companyId)
          .where("supplierId", "in", supplierIds)
          .execute();
      }
      await db
        .deleteFrom("supplierInteraction")
        .where("companyId", "=", scope.companyId)
        .where("supplierId", "in", supplierIds)
        .execute();
      await db
        .deleteFrom("supplier")
        .where("companyId", "=", scope.companyId)
        .where("id", "in", supplierIds)
        .execute();
    });

    async function legacy(supplierId?: string) {
      if (!supplierId) {
        const supplier = await db
          .insertInto("supplier")
          .values({
            name: `Reimbursement adoption ${crypto.randomUUID()}`,
            companyId: scope.companyId,
            createdBy: "system"
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        supplierId = supplier.id;
        supplierIds.push(supplierId);
      }
      const reimbursementRemoteId = crypto.randomUUID();
      const args = {
        ...scope,
        supplierId,
        actorId: "system",
        reimbursementRemoteId,
        supplierReference: `RAMP-REIMB-${reimbursementRemoteId}`,
        exchangeRate: 1,
        dateIssued: "2026-09-11",
        dateDue: "2026-09-12",
        lines: [
          {
            accountId: scope.accountId,
            costCenterId: null,
            amount: 25,
            description: "Reimbursement expense"
          }
        ]
      };
      const staged = await stageOrResumeRampReimbursementInvoice(db, args);
      await db
        .deleteFrom("externalIntegrationMapping")
        .where("companyId", "=", scope.companyId)
        .where("integration", "=", "ramp")
        .where("externalId", "=", reimbursementRemoteId)
        .execute();
      return { args, id: staged.invoiceRowId };
    }

    async function expectNoMapping(id: string) {
      const mappings = await db
        .selectFrom("externalIntegrationMapping")
        .select("id")
        .where("companyId", "=", scope.companyId)
        .where("integration", "=", "ramp")
        .where("entityId", "=", id)
        .execute();
      expect(mappings).toEqual([]);
    }

    it("adopts a complete system Draft once and preserves its stored FX", async () => {
      const { args, id } = await legacy();
      const resumed = await stageOrResumeRampReimbursementInvoice(db, {
        ...args,
        exchangeRate: 2
      });
      expect(resumed).toMatchObject({
        invoiceRowId: id,
        exchangeRate: 1,
        created: false
      });
      const retried = await stageOrResumeRampReimbursementInvoice(db, args);
      expect(retried.invoiceRowId).toBe(id);
    });

    it.each([
      "Pending",
      "Open",
      "Voided",
      "Paid",
      "Return"
    ] satisfies Database["public"]["Enums"]["purchaseInvoiceStatus"][])("rejects a reference-only %s invoice", async (status) => {
      const { args, id } = await legacy();
      await db
        .updateTable("purchaseInvoice")
        .set({ status })
        .where("id", "=", id)
        .where("companyId", "=", scope.companyId)
        .execute();
      await expect(
        stageOrResumeRampReimbursementInvoice(db, args)
      ).rejects.toThrow(/legacy.*Draft/i);
      await expectNoMapping(id);
    });

    it.each([
      "delivery",
      "lines"
    ])("rejects incomplete Draft missing %s without repairing it", async (missing) => {
      const { args, id } = await legacy();
      if (missing === "delivery")
        await db
          .deleteFrom("purchaseInvoiceDelivery")
          .where("id", "=", id)
          .where("companyId", "=", scope.companyId)
          .execute();
      else
        await db
          .deleteFrom("purchaseInvoiceLine")
          .where("invoiceId", "=", id)
          .where("companyId", "=", scope.companyId)
          .execute();
      await expect(
        stageOrResumeRampReimbursementInvoice(db, args)
      ).rejects.toThrow(/complete|match/i);
      await expectNoMapping(id);
      const delivery = await db
        .selectFrom("purchaseInvoiceDelivery")
        .select("id")
        .where("id", "=", id)
        .where("companyId", "=", scope.companyId)
        .execute();
      const lines = await db
        .selectFrom("purchaseInvoiceLine")
        .select("id")
        .where("invoiceId", "=", id)
        .where("companyId", "=", scope.companyId)
        .execute();
      expect(delivery).toHaveLength(missing === "delivery" ? 0 : 1);
      expect(lines).toHaveLength(missing === "lines" ? 0 : 1);
    });

    it.each([
      { postingDate: "2026-09-11" },
      { datePaid: "2026-09-11" },
      { dateIssued: "2026-09-10" },
      { dateDue: "2026-09-13" }
    ])("rejects mismatched legacy header %j", async (change) => {
      const { args, id } = await legacy();
      await db
        .updateTable("purchaseInvoice")
        .set(change)
        .where("id", "=", id)
        .where("companyId", "=", scope.companyId)
        .execute();
      await expect(
        stageOrResumeRampReimbursementInvoice(db, args)
      ).rejects.toThrow(/Draft|match/i);
      await expectNoMapping(id);
    });

    it("rejects a user-created reference-only Draft", async () => {
      const { args, id } = await legacy();
      const user = await db
        .selectFrom("user")
        .select("id")
        .where("id", "!=", "system")
        .limit(1)
        .executeTakeFirstOrThrow();
      await db
        .updateTable("purchaseInvoice")
        .set({ createdBy: user.id })
        .where("id", "=", id)
        .where("companyId", "=", scope.companyId)
        .execute();
      await expect(
        stageOrResumeRampReimbursementInvoice(db, args)
      ).rejects.toThrow(/legacy.*Draft/i);
      await expectNoMapping(id);
    });

    it.each([
      { quantity: 2 },
      { supplierUnitPrice: 30 },
      { supplierTaxAmount: 5 },
      { supplierShippingCost: 5 },
      { exchangeRate: 2 },
      { description: "Unrelated expense" },
      { conversionFactor: 2 }
    ])("rejects mismatched Draft line %j", async (change) => {
      const { args, id } = await legacy();
      await db
        .updateTable("purchaseInvoiceLine")
        .set(change)
        .where("invoiceId", "=", id)
        .where("companyId", "=", scope.companyId)
        .execute();
      await expect(
        stageOrResumeRampReimbursementInvoice(db, args)
      ).rejects.toThrow(/match/i);
      await expectNoMapping(id);
    });

    it("rejects an ambiguous supplier/reference collision", async () => {
      const first = await legacy();
      const second = await legacy(first.args.supplierId);
      await db
        .updateTable("purchaseInvoice")
        .set({ supplierReference: first.args.supplierReference })
        .where("id", "=", second.id)
        .where("companyId", "=", scope.companyId)
        .execute();
      await expect(
        stageOrResumeRampReimbursementInvoice(db, first.args)
      ).rejects.toThrow(/Ambiguous/);
      await expectNoMapping(first.id);
      await expectNoMapping(second.id);
    });

    it("rejects a reference that does not encode this reimbursement identity", async () => {
      const { args, id } = await legacy();
      await expect(
        stageOrResumeRampReimbursementInvoice(db, {
          ...args,
          reimbursementRemoteId: crypto.randomUUID()
        })
      ).rejects.toThrow(/identity|reference/i);
      await expectNoMapping(id);
    });

    it("does not steal a matching Draft mapped to another Ramp source", async () => {
      const { args, id } = await legacy();
      const other = crypto.randomUUID();
      await db
        .insertInto("externalIntegrationMapping")
        .values({
          companyId: scope.companyId,
          integration: "ramp",
          entityType: "bill",
          entityId: id,
          externalId: other,
          createdBy: "system"
        })
        .execute();
      await expect(
        stageOrResumeRampReimbursementInvoice(db, args)
      ).rejects.toThrow(/different Ramp|already linked/i);
      const mapping = await db
        .selectFrom("externalIntegrationMapping")
        .select("externalId")
        .where("companyId", "=", scope.companyId)
        .where("entityId", "=", id)
        .executeTakeFirstOrThrow();
      expect(mapping.externalId).toBe(other);
    });
  }
);
