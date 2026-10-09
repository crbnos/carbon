// Sales and purchase invoices of a company whose optional account defaults
// are empty (.ai/specs/implemented/2026-10-08-accounting-cutover.md section
// 1): a default with no fallback becomes a stand-in line before the cutover,
// a default with a fallback uses it in both states, and a default a schedule
// row needs refuses the posting in both states.

import { MissingAccountDefaultError } from "@carbon/database/journal-posting-status";
import { expect } from "vitest";
import {
  alwaysPostFixture,
  expectPostedJournals,
  expectProvisionalJournals,
  type Fixture,
  journalLinesOf,
  newJournals,
  postSuppliesInvoice,
  seed,
  stampCutover,
  USER,
  unwrap
} from "./always-post-test-fixture";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./local-database-test-fixture";
import postSalesInvoice from "./post-sales-invoice";

/** A Draft service invoice to the fixture's customer for 100, with shipping
 *  and an optional service period. */
async function draftSalesInvoice(
  f: Fixture,
  key: string,
  options: {
    shippingCost?: number;
    servicePeriod?: { start: string; end: string };
  } = {}
): Promise<string> {
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
        status: "Draft",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesInvoiceShipment")
      .values({
        id: invoiceId,
        shippingCost: options.shippingCost ?? 0,
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

/** Makes the fixture's customer and supplier trade with a second company of
 *  the group. */
async function makeIntercompany(f: Fixture) {
  const partnerId = `${f.prefix}-partner`;
  await seed(f, async (trx) => {
    const company = await trx
      .selectFrom("company")
      .select("companyGroupId")
      .where("id", "=", f.companyId)
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("company")
      .values({
        id: partnerId,
        name: partnerId,
        companyGroupId: company.companyGroupId,
        baseCurrencyCode: "USD"
      })
      .execute();
    await trx
      .updateTable("customer")
      .set({ intercompanyCompanyId: partnerId })
      .where("id", "=", f.customerId)
      .execute();
    await trx
      .updateTable("supplier")
      .set({ intercompanyCompanyId: partnerId })
      .where("id", "=", f.supplierId)
      .execute();
  });
}

databaseTest(
  "a sales invoice posts an empty shipping revenue default as a stand-in line on retained earnings before the cutover",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const invoiceId = await draftSalesInvoice(f, "1", { shippingCost: 10 });
      const journals = await newJournals(f, async () =>
        unwrap(await postSalesInvoice(f.ctx, { type: "post", invoiceId }))
      );
      await expectProvisionalJournals(f, journals, "Sales Invoice");

      const lines = await journalLinesOf(f, journals);
      // The placeholder the builders checked the class of is never stored.
      expect(
        lines.some((line) => line.accountId?.startsWith("stand-in:"))
      ).toBe(false);
      expect(lines.filter((line) => line.accountDefaultRole !== null)).toEqual([
        expect.objectContaining({
          accountId: f.account("retained-earnings"),
          accountDefaultRole: "salesShippingRevenueAccount",
          amount: 10
        })
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an intercompany invoice with no intercompany default posts to receivables and payables in both states, with no stand-in",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await makeIntercompany(f);

      const sales = await draftSalesInvoice(f, "1");
      const provisional = await newJournals(f, async () =>
        unwrap(
          await postSalesInvoice(f.ctx, { type: "post", invoiceId: sales })
        )
      );
      const purchase = await newJournals(f, () => postSuppliesInvoice(f));
      await expectProvisionalJournals(f, provisional, "Sales Invoice");
      await expectProvisionalJournals(f, purchase, "Purchase Invoice");
      const provisionalLines = await journalLinesOf(f, [
        ...provisional,
        ...purchase
      ]);
      expect(
        provisionalLines.filter((line) => line.accountDefaultRole !== null)
      ).toEqual([]);
      expect(provisionalLines.map((line) => line.accountId)).toEqual(
        expect.arrayContaining([
          f.account("receivables"),
          f.account("payables")
        ])
      );

      const periodId = await stampCutover(f);
      const later = await draftSalesInvoice(f, "2");
      const posted = await newJournals(f, async () =>
        unwrap(
          await postSalesInvoice(f.ctx, { type: "post", invoiceId: later })
        )
      );
      await expectPostedJournals(f, posted, "Sales Invoice", periodId);
      expect(
        (await journalLinesOf(f, posted)).map((l) => l.accountId)
      ).toContain(f.account("receivables"));
    } finally {
      // The partner rows refuse the cleanup's deletes while they trade.
      await seed(f, async (trx) => {
        const transactions = trx
          .selectFrom("intercompanyTransaction")
          .select("id")
          .where("sourceCompanyId", "=", f.companyId);
        await trx
          .deleteFrom("intercompanyEliminationLine")
          .where("intercompanyTransactionId", "in", transactions)
          .execute();
        await trx
          .deleteFrom("intercompanyTransaction")
          .where("sourceCompanyId", "=", f.companyId)
          .execute();
        await trx
          .updateTable("customer")
          .set({ intercompanyCompanyId: null })
          .where("id", "=", f.customerId)
          .execute();
        await trx
          .updateTable("supplier")
          .set({ intercompanyCompanyId: null })
          .where("id", "=", f.supplierId)
          .execute();
      });
      await f.cleanup();
      const db = await connectLocalTestDatabase();
      await db
        .deleteFrom("company")
        .where("id", "=", `${f.prefix}-partner`)
        .execute();
      await db.destroy();
    }
  }
);

databaseTest(
  "a service invoice with dates refuses an empty deferred revenue default before the cutover, since its schedule rows name the account",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const invoiceId = await draftSalesInvoice(f, "1", {
        servicePeriod: { start: f.cutoverDate, end: f.periodEnd }
      });
      const journals = await newJournals(f, async () => {
        const result = await postSalesInvoice(f.ctx, {
          type: "post",
          invoiceId
        });
        expect(result.error).toMatchObject({
          status: 400,
          message: new MissingAccountDefaultError("deferredRevenueAccount")
            .message
        });
      });
      expect(journals).toEqual([]);
      const schedule = await f.db
        .selectFrom("revenueRecognitionSchedule")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(schedule).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);
