import { createMappingService } from "@carbon/ee/accounting";
import {
  confirmSyncs,
  type RampBill,
  type RampClient
} from "@carbon/ee/ramp.server";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getJobDatabaseClient } from "../../../db";
import {
  type RampBillDraft,
  stageOrResumeRampBill
} from "./ramp-sync-bill-stage";
import type { RampSyncContext } from "./ramp-sync-shared";

vi.mock("@carbon/ee/ramp.server", async (original) => ({
  ...(await original<typeof import("@carbon/ee/ramp.server")>()),
  confirmSyncs: vi.fn()
}));

describe.skipIf(process.env.RUN_RAMP_DB_TESTS !== "true")(
  "Ramp bill staging (Postgres)",
  () => {
    let db: ReturnType<typeof getJobDatabaseClient>;
    let getCarbonServiceRole: typeof import("@carbon/auth/client.server")["getCarbonServiceRole"];
    let syncRampBills: typeof import("./ramp-sync-bill")["syncRampBills"];
    const suppliers: string[] = [];
    let scope: {
      companyId: string;
      companyGroupId: string;
      currencyCode: string;
      accountId: string;
    };
    beforeAll(async () => {
      db = getJobDatabaseClient(2);
      ({ getCarbonServiceRole } = await import("@carbon/auth/client.server"));
      ({ syncRampBills } = await import("./ramp-sync-bill"));
      scope = (await db
        .selectFrom("company")
        .innerJoin(
          "account",
          "account.companyGroupId",
          "company.companyGroupId"
        )
        .select([
          "company.id as companyId",
          "company.companyGroupId",
          "company.baseCurrencyCode as currencyCode",
          "account.id as accountId"
        ])
        .where("account.class", "=", "Expense")
        .where("account.active", "=", true)
        .where("account.isGroup", "=", false)
        .limit(1)
        .executeTakeFirstOrThrow()) as typeof scope;
      const health = await getCarbonServiceRole()
        .from("company")
        .select("id")
        .eq("id", scope.companyId)
        .single();
      expect(health.error).toBeNull();
    }, 30000);

    afterAll(async () => {
      if (!scope || suppliers.length === 0) return;
      const invoices = await db
        .selectFrom("purchaseInvoice")
        .select("id")
        .where("companyId", "=", scope.companyId)
        .where("supplierId", "in", suppliers)
        .execute();
      if (invoices.length)
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
      // These tests only simulate posting by changing status; no edge invocation
      // or journal creation is allowed. Reset only this run's exact fixtures.
      await db
        .updateTable("purchaseInvoice")
        .set({ status: "Draft" })
        .where("companyId", "=", scope.companyId)
        .where("supplierId", "in", suppliers)
        .execute();
      await db
        .deleteFrom("purchaseInvoice")
        .where("companyId", "=", scope.companyId)
        .where("supplierId", "in", suppliers)
        .execute();
      await db
        .deleteFrom("externalIntegrationMapping")
        .where("companyId", "=", scope.companyId)
        .where("integration", "=", "ramp")
        .where(
          "entityId",
          "in",
          db
            .selectFrom("purchaseOrder")
            .select("id")
            .where("companyId", "=", scope.companyId)
            .where("supplierId", "in", suppliers)
        )
        .execute();
      await db
        .deleteFrom("purchaseOrder")
        .where("companyId", "=", scope.companyId)
        .where("supplierId", "in", suppliers)
        .execute();
      await db
        .deleteFrom("supplierInteraction")
        .where("companyId", "=", scope.companyId)
        .where("supplierId", "in", suppliers)
        .execute();
      await db
        .deleteFrom("supplier")
        .where("companyId", "=", scope.companyId)
        .where("id", "in", suppliers)
        .execute();
    }, 30000);

    async function fixture() {
      const token = `RAMP-BILL-TEST-${crypto.randomUUID()}`;
      const supplier = await db
        .insertInto("supplier")
        .values({
          name: token,
          companyId: scope.companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      suppliers.push(supplier.id);
      const client = getCarbonServiceRole();
      // Only the remote posting invocation is substituted. All staging, status
      // transitions, queries, mappings, FKs and rollback use real Postgres.
      const invoke = vi.fn(
        async (_name: string, options?: { body?: unknown }) => {
          const body = options?.body as { invoiceId: string };
          await db
            .updateTable("purchaseInvoice")
            .set({ status: "Draft" })
            .where("companyId", "=", scope.companyId)
            .where("id", "=", body.invoiceId)
            .execute();
          return {
            data: null,
            error: new Error("simulated posting failure"),
            response: undefined
          };
        }
      );
      // Supabase.functions is a getter that returns a NEW FunctionsClient. Spying
      // on one getter result does not intercept later calls; pin this instance.
      Object.defineProperty(client, "functions", { value: { invoke } });
      const ctx: RampSyncContext = {
        client,
        db,
        companyId: scope.companyId,
        companyGroupId: scope.companyGroupId,
        baseCurrency: scope.currencyCode,
        mapping: createMappingService(db, scope.companyId),
        decimalsCache: new Map(),
        exchangeRateCache: new Map(),
        metadata: { sync: { pullBills: true } } as RampSyncContext["metadata"]
      };
      const bill: RampBill = {
        id: token,
        invoice_number: token,
        issued_at: "2026-09-10",
        due_at: "2026-09-11",
        currency_code: scope.currencyCode,
        amount: { amount: 10000, currency_code: scope.currencyCode },
        vendor: { name: token },
        line_items: [
          {
            amount: { amount: 10000, currency_code: scope.currencyCode },
            memo: token,
            accounting_field_selections: [
              {
                external_id: scope.accountId,
                category_info: { type: "GL_ACCOUNT" }
              }
            ]
          }
        ]
      };
      const ramp = {
        async *listBills() {
          yield [bill];
        }
      } as RampClient;
      const args: RampBillDraft = {
        companyId: scope.companyId,
        sourceId: token,
        supplierId: supplier.id,
        supplierReference: token,
        currencyCode: scope.currencyCode,
        exchangeRate: 1,
        decimals: 2,
        totalAmount: 100,
        dateIssued: "2026-09-10",
        dateDue: "2026-09-11",
        lines: [
          {
            accountId: scope.accountId,
            costCenterId: null,
            amount: 100,
            description: token
          }
        ]
      };
      return { token, supplierId: supplier.id, ctx, bill, ramp, args, invoke };
    }

    async function purchaseOrderFixture() {
      const fixtureData = await fixture();
      const interaction = await db
        .insertInto("supplierInteraction")
        .values({
          companyId: scope.companyId,
          supplierId: fixtureData.supplierId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const po = await db
        .insertInto("purchaseOrder")
        .values({
          companyId: scope.companyId,
          createdBy: "system",
          purchaseOrderId: fixtureData.token,
          supplierId: fixtureData.supplierId,
          supplierInteractionId: interaction.id,
          currencyCode: scope.currencyCode,
          status: "To Receive and Invoice"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const poLines = await db
        .insertInto("purchaseOrderLine")
        .values(
          [1, 2].map((index) => ({
            companyId: scope.companyId,
            createdBy: "system",
            purchaseOrderId: po.id,
            purchaseOrderLineType: "G/L Account" as const,
            purchaseQuantity: 10,
            supplierUnitPrice: 20,
            accountId: scope.accountId,
            sortOrder: index
          }))
        )
        .returning("id")
        .execute();
      const remotePoId = `po-${fixtureData.token}`;
      await fixtureData.ctx.mapping.link(
        "purchaseOrder",
        po.id,
        "ramp",
        remotePoId
      );
      fixtureData.bill.purchase_order_id = remotePoId;
      fixtureData.bill.line_items![0]!.purchase_order_line_item_id =
        "remote-line-1";
      const request = vi.fn(async () => ({
        line_items: [{ id: "remote-line-1", external_id: poLines[0]!.id }]
      }));
      Object.assign(fixtureData.ramp, { request });
      return { ...fixtureData, po, poLines, remotePoId, request };
    }

    it("keeps one mapped Draft after a posting failure and retries that same Draft", async () => {
      const { token, ctx, ramp, invoke } = await fixture();
      await syncRampBills(ctx, ramp, undefined);
      await syncRampBills(ctx, ramp, undefined);
      const invoices = await db
        .selectFrom("purchaseInvoice")
        .select(["id", "status"])
        .where("companyId", "=", scope.companyId)
        .where("supplierReference", "=", token)
        .execute();
      expect(invoices).toHaveLength(1);
      expect(invoices[0]?.status).toBe("Draft");
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(await ctx.mapping.getEntityId("ramp", token, "bill")).toBe(
        invoices[0]?.id
      );
    }, 30000);

    it("converges simultaneous deliveries of one source bill to one mapped Draft", async () => {
      const { token, ctx, ramp } = await fixture();
      await Promise.all([
        syncRampBills(ctx, ramp, undefined),
        syncRampBills(ctx, ramp, undefined)
      ]);
      const invoices = await db
        .selectFrom("purchaseInvoice")
        .select("id")
        .where("companyId", "=", scope.companyId)
        .where("supplierReference", "=", token)
        .execute();
      expect(invoices).toHaveLength(1);
      expect(await ctx.mapping.getEntityId("ramp", token, "bill")).toBe(
        invoices[0]?.id
      );
    }, 30000);

    it("rolls back the header, interaction, delivery and lines when the final mapping write fails", async () => {
      const { token, args, supplierId } = await fixture();
      const name = `ramp_bill_fail_${crypto.randomUUID().replaceAll("-", "")}`;
      // Fault is guarded by this test's unguessable source id, never global.
      await sql
        .raw(
          `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ramp_bill_mapping_fault'; END $$`
        )
        .execute(db);
      try {
        await sql
          .raw(
            `CREATE TRIGGER ${name} BEFORE INSERT ON "externalIntegrationMapping" FOR EACH ROW WHEN (NEW."externalId" = '${token}') EXECUTE FUNCTION ${name}()`
          )
          .execute(db);
        await expect(stageOrResumeRampBill(db, args)).rejects.toThrow(
          "ramp_bill_mapping_fault"
        );
        expect(
          await db
            .selectFrom("purchaseInvoice")
            .select("id")
            .where("companyId", "=", scope.companyId)
            .where("supplierId", "=", supplierId)
            .execute()
        ).toHaveLength(0);
        expect(
          await db
            .selectFrom("supplierInteraction")
            .select("id")
            .where("companyId", "=", scope.companyId)
            .where("supplierId", "=", supplierId)
            .execute()
        ).toHaveLength(0);
        expect(
          await createMappingService(db, scope.companyId).getEntityId(
            "ramp",
            token,
            "bill"
          )
        ).toBeNull();
      } finally {
        await sql
          .raw(`DROP TRIGGER IF EXISTS ${name} ON "externalIntegrationMapping"`)
          .execute(db);
        await sql.raw(`DROP FUNCTION ${name}()`).execute(db);
      }
    }, 30000);

    it("resumes a committed Draft after a crash and confirms only after an observed post", async () => {
      const { args, ctx, ramp, invoke, token } = await fixture();
      const staged = await stageOrResumeRampBill(db, args); // crash before invoking edge
      invoke.mockImplementationOnce(async () => {
        await db
          .updateTable("purchaseInvoice")
          .set({ status: "Open" })
          .where("companyId", "=", scope.companyId)
          .where("id", "=", staged.invoiceRowId)
          .execute();
        return {
          data: null,
          error: new Error("response lost after commit"),
          response: undefined
        };
      });
      vi.mocked(confirmSyncs).mockClear();
      expect(await syncRampBills(ctx, ramp, undefined)).toMatchObject({
        created: 1,
        failed: 0
      });
      expect(
        vi.mocked(confirmSyncs).mock.calls.at(-1)?.[2].successful
      ).toMatchObject([{ id: token }]);
      expect(await ctx.mapping.getEntityId("ramp", token, "bill")).toBe(
        staged.invoiceRowId
      );
      expect(invoke).toHaveBeenCalledTimes(1);
    }, 30000);

    it.each([
      "Pending",
      "Voided"
    ] as const)("never posts or confirms a mapped %s invoice", async (status) => {
      const { args, ctx, ramp, invoke } = await fixture();
      const staged = await stageOrResumeRampBill(db, args);
      await db
        .updateTable("purchaseInvoice")
        .set({ status })
        .where("companyId", "=", scope.companyId)
        .where("id", "=", staged.invoiceRowId)
        .execute();
      vi.mocked(confirmSyncs).mockClear();
      expect(await syncRampBills(ctx, ramp, undefined)).toMatchObject({
        created: 0,
        reconfirmed: 0,
        failed: 1
      });
      expect(vi.mocked(confirmSyncs).mock.calls.at(-1)?.[2].successful).toEqual(
        []
      );
      expect(invoke).not.toHaveBeenCalled();
    }, 30000);

    it("adopts one exact legacy system Draft without changing its source mapping on collision", async () => {
      const { args, ctx } = await fixture();
      const staged = await stageOrResumeRampBill(db, args);
      await ctx.mapping.unlink("bill", staged.invoiceRowId, "ramp");
      expect((await stageOrResumeRampBill(db, args)).invoiceRowId).toBe(
        staged.invoiceRowId
      );
      await expect(
        stageOrResumeRampBill(db, {
          ...args,
          sourceId: `${args.sourceId}-other`
        })
      ).rejects.toThrow("different Ramp bill");
      expect(await ctx.mapping.getEntityId("ramp", args.sourceId, "bill")).toBe(
        staged.invoiceRowId
      );
    }, 30000);

    it("uses Ramp-covered PO amounts, removes uncovered PO lines and adds an exactly coded adjustment", async () => {
      const { ctx, ramp, bill, po, poLines } = await purchaseOrderFixture();
      bill.amount = { amount: 10500, currency_code: scope.currencyCode };
      await syncRampBills(ctx, ramp, undefined);
      const id = await ctx.mapping.getEntityId("ramp", bill.id, "bill");
      expect(id).toBeTruthy();
      const lines = await db
        .selectFrom("purchaseInvoiceLine")
        .selectAll()
        .where("companyId", "=", scope.companyId)
        .where("invoiceId", "=", id!)
        .orderBy("sortOrder")
        .execute();
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({
        purchaseOrderId: po.id,
        purchaseOrderLineId: poLines[0]!.id,
        quantity: 5,
        supplierUnitPrice: 20
      });
      expect(lines[1]).toMatchObject({
        purchaseOrderId: null,
        purchaseOrderLineId: null,
        accountId: scope.accountId,
        quantity: 1,
        supplierUnitPrice: 5
      });
      expect(
        lines.reduce(
          (sum, line) => sum + line.quantity * line.supplierUnitPrice,
          0
        )
      ).toBe(105);
    }, 30000);

    it("posts multi-PO bills standalone with a memo and never invokes conversion", async () => {
      const { ctx, ramp, bill, remotePoId, request, invoke } =
        await purchaseOrderFixture();
      bill.purchase_order_ids = [remotePoId, "another-po"];
      await syncRampBills(ctx, ramp, undefined);
      const id = await ctx.mapping.getEntityId("ramp", bill.id, "bill");
      expect(id).toBeTruthy();
      const invoice = await db
        .selectFrom("purchaseInvoice")
        .select("internalNotes")
        .where("companyId", "=", scope.companyId)
        .where("id", "=", id!)
        .executeTakeFirstOrThrow();
      expect(JSON.stringify(invoice.internalNotes)).toContain(
        "posted standalone"
      );
      const lines = await db
        .selectFrom("purchaseInvoiceLine")
        .select("purchaseOrderId")
        .where("companyId", "=", scope.companyId)
        .where("invoiceId", "=", id!)
        .execute();
      expect(lines.every((line) => line.purchaseOrderId === null)).toBe(true);
      expect(request).not.toHaveBeenCalled();
      expect(
        invoke.mock.calls.every(([name]) => name === "post-purchase-invoice")
      ).toBe(true);
    }, 30000);

    it("does not adopt an unrelated Draft just because it references the same PO", async () => {
      const { ctx, ramp, bill, args, po, poLines } =
        await purchaseOrderFixture();
      const unrelated = await stageOrResumeRampBill(db, {
        ...args,
        sourceId: `${args.sourceId}-unrelated`,
        supplierReference: "Other supplier reference",
        purchaseOrderId: po.id,
        lines: [{ ...args.lines[0]!, purchaseOrderLineId: poLines[1]!.id }]
      });
      await syncRampBills(ctx, ramp, undefined);
      expect(await ctx.mapping.getEntityId("ramp", bill.id, "bill")).not.toBe(
        unrelated.invoiceRowId
      );
      const preserved = await db
        .selectFrom("purchaseInvoice")
        .select("supplierReference")
        .where("companyId", "=", scope.companyId)
        .where("id", "=", unrelated.invoiceRowId)
        .executeTakeFirstOrThrow();
      expect(preserved.supplierReference).toBe("Other supplier reference");
    }, 30000);

    it("rejects an incomplete legacy Draft instead of creating or confirming another invoice", async () => {
      const { args, ctx, ramp, invoke } = await fixture();
      const staged = await stageOrResumeRampBill(db, args);
      await ctx.mapping.unlink("bill", staged.invoiceRowId, "ramp");
      await db
        .deleteFrom("purchaseInvoiceDelivery")
        .where("companyId", "=", scope.companyId)
        .where("id", "=", staged.invoiceRowId)
        .execute();
      expect(await syncRampBills(ctx, ramp, undefined)).toMatchObject({
        created: 0,
        reconfirmed: 0,
        failed: 1
      });
      expect(
        await ctx.mapping.getEntityId("ramp", args.sourceId, "bill")
      ).toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    }, 30000);

    it("refuses ambiguous matching legacy Drafts", async () => {
      const { args, ctx } = await fixture();
      const first = await stageOrResumeRampBill(db, args);
      const second = await stageOrResumeRampBill(db, {
        ...args,
        sourceId: `${args.sourceId}-second`,
        supplierReference: "Initially distinct"
      });
      await ctx.mapping.unlink("bill", first.invoiceRowId, "ramp");
      await ctx.mapping.unlink("bill", second.invoiceRowId, "ramp");
      await db
        .updateTable("purchaseInvoice")
        .set({ supplierReference: args.supplierReference })
        .where("companyId", "=", scope.companyId)
        .where("id", "=", second.invoiceRowId)
        .execute();
      await expect(stageOrResumeRampBill(db, args)).rejects.toThrow(
        "Ambiguous legacy"
      );
      expect(
        await ctx.mapping.getEntityId("ramp", args.sourceId, "bill")
      ).toBeNull();
    }, 30000);

    it("allows only one of two concurrent source ids to adopt a valid legacy Draft", async () => {
      const { args, ctx } = await fixture();
      const staged = await stageOrResumeRampBill(db, args);
      await ctx.mapping.unlink("bill", staged.invoiceRowId, "ramp");
      const outcomes = await Promise.allSettled([
        stageOrResumeRampBill(db, args),
        stageOrResumeRampBill(db, {
          ...args,
          sourceId: `${args.sourceId}-other`
        })
      ]);
      expect(
        outcomes.filter((outcome) => outcome.status === "fulfilled")
      ).toHaveLength(1);
      const failed = outcomes.find(
        (outcome) => outcome.status === "rejected"
      ) as PromiseRejectedResult;
      expect(failed.reason.message).toContain("different Ramp bill");
    }, 30000);

    it("refuses a mapped PO Draft whose equal total hides a different invoiced quantity", async () => {
      const { args, po, poLines } = await purchaseOrderFixture();
      const linked = {
        ...args,
        purchaseOrderId: po.id,
        lines: [
          {
            ...args.lines[0]!,
            purchaseOrderLineId: poLines[0]!.id,
            quantity: 5
          }
        ]
      };
      const staged = await stageOrResumeRampBill(db, linked);
      await db
        .updateTable("purchaseInvoiceLine")
        .set({ quantity: 10, supplierUnitPrice: 10 })
        .where("companyId", "=", scope.companyId)
        .where("invoiceId", "=", staged.invoiceRowId)
        .execute();
      await expect(stageOrResumeRampBill(db, linked)).rejects.toThrow(
        "complete Ramp bill lines"
      );
    }, 30000);

    it("does not adopt an unmapped posted invoice merely because supplier reference and total match", async () => {
      const { args, ctx } = await fixture();
      const staged = await stageOrResumeRampBill(db, args);
      await ctx.mapping.unlink("bill", staged.invoiceRowId, "ramp");
      await db
        .updateTable("purchaseInvoiceLine")
        .set({ supplierUnitPrice: 50 })
        .where("companyId", "=", scope.companyId)
        .where("invoiceId", "=", staged.invoiceRowId)
        .execute();
      await db
        .insertInto("purchaseInvoiceLine")
        .values({
          invoiceId: staged.invoiceRowId,
          companyId: scope.companyId,
          createdBy: "system",
          invoiceLineType: "G/L Account",
          accountId: scope.accountId,
          quantity: 1,
          supplierUnitPrice: 50,
          sortOrder: 2
        })
        .execute();
      await db
        .updateTable("purchaseInvoice")
        .set({ status: "Open" })
        .where("companyId", "=", scope.companyId)
        .where("id", "=", staged.invoiceRowId)
        .execute();
      await expect(stageOrResumeRampBill(db, args)).rejects.toThrow(
        "not a valid legacy"
      );
      expect(
        await ctx.mapping.getEntityId("ramp", args.sourceId, "bill")
      ).toBeNull();
    }, 30000);

    it("stores foreign principal in supplier fields and lets generated fields convert to base", async () => {
      const { args } = await fixture();
      const currency = await db
        .selectFrom("currency")
        .select("code")
        .where("companyGroupId", "=", scope.companyGroupId)
        .where("code", "!=", scope.currencyCode)
        .executeTakeFirstOrThrow();
      const staged = await stageOrResumeRampBill(db, {
        ...args,
        currencyCode: currency.code,
        exchangeRate: 2
      });
      const line = await db
        .selectFrom("purchaseInvoiceLine")
        .select([
          "supplierUnitPrice",
          "unitPrice",
          "totalAmount",
          "exchangeRate"
        ])
        .where("companyId", "=", scope.companyId)
        .where("invoiceId", "=", staged.invoiceRowId)
        .executeTakeFirstOrThrow();
      expect(line).toMatchObject({
        supplierUnitPrice: 100,
        unitPrice: 50,
        totalAmount: 50,
        exchangeRate: 2
      });
    }, 30000);

    it("rejects a second bill reserving the same unposted PO line", async () => {
      const { args, po, poLines } = await purchaseOrderFixture();
      const linked = {
        ...args,
        purchaseOrderId: po.id,
        lines: [{ ...args.lines[0]!, purchaseOrderLineId: poLines[0]!.id }]
      };
      await stageOrResumeRampBill(db, linked);
      await expect(
        stageOrResumeRampBill(db, {
          ...linked,
          sourceId: `${args.sourceId}-second`,
          supplierReference: "Another bill"
        })
      ).rejects.toThrow("already reserved");
    }, 30000);
  }
);
