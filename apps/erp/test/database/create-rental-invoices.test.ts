// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The rental invoice generator against the live database: a Closed agreement
// whose invoice was voided still bills the rows the void returned to
// unbilled, and amounts priced in the agreement's currency land on the
// invoice line in base currency. A charge shares the rent's invoice unless it
// is invoiced separately, which drafts it on its own held invoice.

import { RENTAL_HOLD_CHARGES } from "@carbon/utils";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";
import {
  createRentalInvoices,
  getRentalNextInvoice
} from "../../app/modules/sales/sales.service";
import { invokePosting } from "../../app/modules/shared/shared.service";

const USER = "system";

async function closedAgreementFixture({
  invoiceSeparately = false,
  status = "Closed" as "Closed" | "Active",
  withPeriod = true,
  chargeDate = "2026-09-01",
  withTaxCode = false,
  withEarlyReturnCredits = false
} = {}) {
  const db = await connectLocalTestDatabase();
  const prefix = `rentest-${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const customerId = `${prefix}-customer`;
  const itemId = `${prefix}-item`;
  const locationId = `${prefix}-location`;
  const agreementId = `${prefix}-agreement`;
  const lineId = `${prefix}-line`;
  const periodId = `${prefix}-period`;
  const chargeId = `${prefix}-charge`;
  const taxCodeId = `${prefix}-taxcode`;
  const octoberPeriodId = `${prefix}-period-oct`;
  const septemberCreditId = `${prefix}-credit-sep`;
  const octoberCreditId = `${prefix}-credit-oct`;

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({ id: groupId, name: prefix, createdBy: USER })
      .execute();
    await trx
      .insertInto("company")
      .values({
        id: companyId,
        name: prefix,
        companyGroupId: groupId,
        baseCurrencyCode: "USD",
        timezone: "America/New_York"
      })
      .execute();
    await trx
      .insertInto("currency")
      .values({
        code: "USD",
        decimalPlaces: 2,
        companyGroupId: groupId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("companySettings")
      .values({ id: companyId })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await trx
      .insertInto("sequence")
      .values(
        [
          { table: "salesInvoice", name: "Sales Invoice", prefix: "INV-" },
          { table: "creditMemo", name: "Credit Memo", prefix: "CM-" }
        ].map((row) => ({ ...row, companyId }))
      )
      .execute();
    await trx
      .insertInto("customer")
      .values({ id: customerId, name: prefix, companyId })
      .execute();
    await trx
      .insertInto("location")
      .values({
        id: locationId,
        name: "Headquarters",
        addressLine1: "1 Main St",
        city: "Springfield",
        postalCode: "00000",
        timezone: "America/New_York",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("item")
      .values({
        id: itemId,
        readableId: `${prefix}-LIFT`,
        name: "Scissor lift",
        type: "Part",
        itemTrackingType: "Inventory",
        companyId,
        createdBy: USER
      })
      .execute();
    // 10% throughout, plus 5% from October: a September line bills 10% and
    // an October line 15%, whatever the agreement's stored percent says.
    if (withTaxCode) {
      await trx
        .insertInto("taxCode")
        .values({
          id: taxCodeId,
          name: "Rental VAT",
          companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("taxCodeComponent")
        .values([
          {
            taxCodeId,
            name: "State",
            taxPercent: 0.1,
            sequence: 1,
            companyId,
            createdBy: USER
          },
          {
            taxCodeId,
            name: "City",
            taxPercent: 0.05,
            sequence: 2,
            effectiveDate: "2026-10-01",
            companyId,
            createdBy: USER
          }
        ])
        .execute();
    }
    // Closed with nothing unbilled, then a void returned one period and one
    // charge to unbilled. Priced at 2 agreement units per base unit.
    await trx
      .insertInto("rentalAgreement")
      .values({
        id: agreementId,
        rentalAgreementId: "RA-TEST",
        customerId,
        locationId,
        currencyCode: "USD",
        exchangeRate: 2,
        discountRate: 0,
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        status,
        // The rate frozen when the code was picked; the code's dated
        // components decide what each line bills.
        ...(withTaxCode ? { taxCodeId, taxPercent: 0.02 } : {}),
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("rentalAgreementLine")
      .values({
        id: lineId,
        rentalAgreementId: agreementId,
        itemId,
        rate: 300,
        status: "Returned",
        companyId,
        createdBy: USER
      })
      .execute();
    if (withPeriod)
      await trx
      .insertInto("rentalBillingPeriod")
      .values({
        id: periodId,
        rentalAgreementLineId: lineId,
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        days: 30,
        amount: 300,
        dueOn: "2026-09-01",
        status: "Pending",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("rentalAgreementCharge")
      .values({
        id: chargeId,
        rentalAgreementLineId: lineId,
        description: "Delivery",
        amount: 50,
        chargeDate,
        invoiceSeparately,
        ...(withTaxCode ? { taxCodeId, taxPercent: 0.02 } : {}),
        companyId,
        createdBy: USER
      })
      .execute();
    if (withTaxCode) {
      await trx
        .insertInto("rentalBillingPeriod")
        .values({
          id: octoberPeriodId,
          rentalAgreementLineId: lineId,
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31",
          days: 31,
          amount: 300,
          dueOn: "2026-10-01",
          status: "Pending",
          companyId,
          createdBy: USER
        })
        .execute();
    }
    // Two early-return credits, one in each month: the code's rate on each
    // period's start differs (10% in September, 15% from October), but both
    // credit at the rate on the memo's date.
    if (withEarlyReturnCredits) {
      await trx
        .insertInto("rentalBillingPeriod")
        .values([
          {
            id: septemberCreditId,
            rentalAgreementLineId: lineId,
            periodStart: "2026-09-01",
            periodEnd: "2026-09-30",
            days: 30,
            amount: -100,
            isAdjustment: true,
            dueOn: "2026-09-30",
            status: "Pending",
            companyId,
            createdBy: USER
          },
          {
            id: octoberCreditId,
            rentalAgreementLineId: lineId,
            periodStart: "2026-10-01",
            periodEnd: "2026-10-31",
            days: 31,
            amount: -60,
            isAdjustment: true,
            dueOn: "2026-10-01",
            status: "Pending",
            companyId,
            createdBy: USER
          }
        ])
        .execute();
    }
  });

  const ctx = { db, companyId, userId: USER };

  return {
    db,
    ctx,
    companyId,
    agreementId,
    periodId,
    octoberPeriodId,
    septemberCreditId,
    octoberCreditId,
    chargeId,
    taxCodeId,
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

databaseTest(
  "a Closed agreement bills the rows a void returned to unbilled, in base currency",
  async () => {
    const f = await closedAgreementFixture();
    try {
      const result = await invokePosting(
        f.ctx,
        "create-rental-invoices",
        { asOf: "2026-10-05" },
        createRentalInvoices
      );
      expect(result.error).toBeNull();
      expect(result.data!.failures).toEqual([]);
      expect(result.data!.invoices.length).toBeGreaterThan(0);

      const lines = await f.db
        .selectFrom("salesInvoiceLine")
        .select([
          "rentalBillingPeriodId",
          "rentalAgreementChargeId",
          "unitPrice"
        ])
        .where("companyId", "=", f.companyId)
        .where("rentalAgreementId", "=", f.agreementId)
        .execute();
      const rent = lines.find((l) => l.rentalBillingPeriodId === f.periodId);
      const charge = lines.find(
        (l) => l.rentalAgreementChargeId === f.chargeId
      );
      // 300 and 50 agreement units at 2 per base unit.
      expect(Number(rent?.unitPrice)).toBe(150);
      expect(Number(charge?.unitPrice)).toBe(25);

      const period = await f.db
        .selectFrom("rentalBillingPeriod")
        .select("status")
        .where("id", "=", f.periodId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(period.status).toEqual("Invoiced");

      // A second run finds nothing left to bill.
      const again = await invokePosting(
        f.ctx,
        "create-rental-invoices",
        { asOf: "2026-10-05" },
        createRentalInvoices
      );
      expect(again.error).toBeNull();
      expect(again.data!.invoices).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a charge lands on the rent invoice, unheld", async () => {
  const f = await closedAgreementFixture();
  try {
    const result = await invokePosting(
      f.ctx,
      "create-rental-invoices",
      { asOf: "2026-10-05" },
      createRentalInvoices
    );
    expect(result.error).toBeNull();
    expect(result.data!.failures).toEqual([]);
    expect(result.data!.invoices).toHaveLength(1);
    expect(result.data!.invoices[0]?.holdReason).toBeNull();

    const byLine = await invoiceIdsByLine(f);
    expect(byLine.rent).toBeDefined();
    expect(byLine.charge).toBe(byLine.rent);
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a separately invoiced charge gets its own held invoice",
  async () => {
    const f = await closedAgreementFixture({ invoiceSeparately: true });
    try {
      const result = await invokePosting(
        f.ctx,
        "create-rental-invoices",
        { asOf: "2026-10-05" },
        createRentalInvoices
      );
      expect(result.error).toBeNull();
      expect(result.data!.failures).toEqual([]);
      expect(result.data!.invoices).toHaveLength(2);

      const byLine = await invoiceIdsByLine(f);
      expect(byLine.charge).toBeDefined();
      expect(byLine.charge).not.toBe(byLine.rent);
      const held = result.data!.invoices.find(
        (invoice) => invoice.invoiceId === byLine.charge
      );
      expect(held?.holdReason).toBe(RENTAL_HOLD_CHARGES);
    } finally {
      await f.cleanup();
    }
  }
);

/** Every row a preview must not write: invoices, opportunities, the invoice
 *  number sequence, and the billing stamps. */
async function billingState(
  f: Awaited<ReturnType<typeof closedAgreementFixture>>
) {
  const [invoices, opportunities, sequence, periods, charges] =
    await Promise.all([
      f.db
        .selectFrom("salesInvoice")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute(),
      f.db
        .selectFrom("opportunity")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute(),
      f.db
        .selectFrom("sequence")
        .selectAll()
        .where("companyId", "=", f.companyId)
        .where("table", "=", "salesInvoice")
        .execute(),
      f.db
        .selectFrom("rentalBillingPeriod")
        .select(["id", "status", "salesInvoiceLineId"])
        .where("companyId", "=", f.companyId)
        .execute(),
      f.db
        .selectFrom("rentalAgreementCharge")
        .select(["id", "salesInvoiceLineId"])
        .where("companyId", "=", f.companyId)
        .execute()
    ]);
  return { invoices, opportunities, sequence, periods, charges };
}

for (const withTaxCode of [false, true]) {
databaseTest(
  `the Next Invoice preview is what the run drafts, and writes nothing${withTaxCode ? " (with a tax code)" : ""}`,
  async () => {
    const f = await closedAgreementFixture({ status: "Active", withTaxCode });
    try {
      const before = await billingState(f);
      const preview = await getRentalNextInvoice(f.db, {
        companyId: f.companyId,
        rentalAgreementId: f.agreementId,
        today: "2026-10-05"
      });
      expect(await billingState(f)).toEqual(before);
      expect(preview?.asOf).toBe("2026-10-05");

      const result = await invokePosting(
        f.ctx,
        "create-rental-invoices",
        { asOf: preview!.asOf },
        createRentalInvoices
      );
      expect(result.error).toBeNull();
      expect(result.data!.failures).toEqual([]);

      const drafted = await f.db
        .selectFrom("salesInvoice as i")
        .innerJoin("salesInvoiceLine as l", "l.invoiceId", "i.id")
        .select([
          "i.subtotal",
          "i.totalTax",
          "i.totalAmount",
          "l.rentalBillingPeriodId",
          "l.rentalAgreementChargeId",
          "l.description",
          "l.unitPrice",
          "l.taxPercent"
        ])
        .where("i.companyId", "=", f.companyId)
        .orderBy("l.sortOrder")
        .execute();
      expect(
        drafted.map((line) => ({
          rentalBillingPeriodId: line.rentalBillingPeriodId,
          rentalAgreementChargeId: line.rentalAgreementChargeId,
          description: line.description,
          unitPrice: Number(line.unitPrice),
          taxPercent: Number(line.taxPercent)
        }))
      ).toEqual(
        preview!.invoices.flatMap((invoice) =>
          invoice.lines.map((line) => ({
            rentalBillingPeriodId: line.rentalBillingPeriodId,
            rentalAgreementChargeId: line.rentalAgreementChargeId,
            description: line.description,
            unitPrice: line.unitPrice,
            taxPercent: line.taxPercent
          }))
        )
      );
      expect({
        subtotal: Number(drafted[0]?.subtotal),
        totalTax: Number(drafted[0]?.totalTax),
        totalAmount: Number(drafted[0]?.totalAmount)
      }).toEqual({
        subtotal: preview!.invoices[0]!.subtotal,
        totalTax: preview!.invoices[0]!.totalTax,
        totalAmount: preview!.invoices[0]!.totalAmount
      });
    } finally {
      await f.cleanup();
    }
  }
);
}

databaseTest(
  "the Next Invoice preview waits for a charge dated after today",
  async () => {
    const f = await closedAgreementFixture({
      status: "Active",
      withPeriod: false,
      chargeDate: "2026-12-20"
    });
    try {
      const preview = await getRentalNextInvoice(f.db, {
        companyId: f.companyId,
        rentalAgreementId: f.agreementId,
        today: "2026-10-05"
      });
      expect(preview?.asOf).toBe("2026-12-20");
      expect(
        preview?.invoices.flatMap((invoice) =>
          invoice.lines.map((line) => line.rentalAgreementChargeId)
        )
      ).toEqual([f.chargeId]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a line with a tax code bills at the code's rate on the invoice's date",
  async () => {
    const f = await closedAgreementFixture({ withTaxCode: true });
    try {
      const result = await invokePosting(
        f.ctx,
        "create-rental-invoices",
        { asOf: "2026-10-05" },
        createRentalInvoices
      );
      expect(result.error).toBeNull();
      expect(result.data!.failures).toEqual([]);
      expect(result.data!.invoices).toHaveLength(1);

      const lines = await f.db
        .selectFrom("salesInvoiceLine")
        .select([
          "rentalBillingPeriodId",
          "rentalAgreementChargeId",
          "taxCodeId",
          "taxPercent",
          "unitPrice"
        ])
        .where("companyId", "=", f.companyId)
        .where("rentalAgreementId", "=", f.agreementId)
        .execute();
      const rate = (line: (typeof lines)[number] | undefined) => ({
        taxCodeId: line?.taxCodeId,
        taxPercent: Number(line?.taxPercent)
      });
      // The invoice is dated 5 October, so every line takes the code's rate
      // then (10% + the 5% component that starts on 1 October), even the
      // September period: the invoice date is the tax point.
      expect(
        rate(lines.find((l) => l.rentalBillingPeriodId === f.periodId))
      ).toEqual({ taxCodeId: f.taxCodeId, taxPercent: 0.15 });
      expect(
        rate(lines.find((l) => l.rentalBillingPeriodId === f.octoberPeriodId))
      ).toEqual({ taxCodeId: f.taxCodeId, taxPercent: 0.15 });
      expect(
        rate(lines.find((l) => l.rentalAgreementChargeId === f.chargeId))
      ).toEqual({ taxCodeId: f.taxCodeId, taxPercent: 0.15 });

      // The header totals are the lines': (150 + 150 + 25) × 15%.
      const invoice = await f.db
        .selectFrom("salesInvoice")
        .select(["subtotal", "totalTax", "totalAmount"])
        .where("id", "=", result.data!.invoices[0]!.invoiceId)
        .executeTakeFirstOrThrow();
      expect({
        subtotal: Number(invoice.subtotal),
        totalTax: Number(invoice.totalTax),
        totalAmount: Number(invoice.totalAmount)
      }).toEqual({ subtotal: 325, totalTax: 48.75, totalAmount: 373.75 });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "early-return credits from two rate periods go on one credit memo at the code's rate on the memo date",
  async () => {
    const f = await closedAgreementFixture({
      withTaxCode: true,
      withEarlyReturnCredits: true
    });
    try {
      const result = await invokePosting(
        f.ctx,
        "create-rental-invoices",
        { asOf: "2026-10-05" },
        createRentalInvoices
      );
      expect(result.error).toBeNull();
      expect(result.data!.failures).toEqual([]);
      const memoIds = result.data!.creditMemos.map((memo) => memo.memoId);
      expect(memoIds).toHaveLength(1);

      const memo = await f.db
        .selectFrom("memo")
        .select(["amount", "taxAmount", "taxCodeId", "status", "memoDate"])
        .where("companyId", "=", f.companyId)
        .where("id", "=", memoIds[0]!)
        .executeTakeFirstOrThrow();
      // 100 (a September period) + 60 (October), both at 15%: the code's
      // rate on 5 October, the memo's date and tax point. `amount` is the
      // gross.
      expect({
        amount: Number(memo.amount),
        taxAmount: Number(memo.taxAmount),
        taxCodeId: memo.taxCodeId,
        status: memo.status,
        memoDate: String(memo.memoDate)
      }).toEqual({
        amount: 184,
        taxAmount: 24,
        taxCodeId: f.taxCodeId,
        status: "Draft",
        memoDate: "2026-10-05"
      });

      // Both credits are stamped with the memo.
      const credits = await f.db
        .selectFrom("rentalBillingPeriod")
        .select(["id", "memoId", "status"])
        .where("companyId", "=", f.companyId)
        .where("id", "in", [f.septemberCreditId, f.octoberCreditId])
        .execute();
      expect(
        Object.fromEntries(credits.map((c) => [c.id, [c.memoId, c.status]]))
      ).toEqual({
        [f.septemberCreditId]: [memoIds[0], "Invoiced"],
        [f.octoberCreditId]: [memoIds[0], "Invoiced"]
      });
    } finally {
      await f.cleanup();
    }
  }
);

/** The invoice each of the fixture's two rows was billed on. */
async function invoiceIdsByLine(
  f: Awaited<ReturnType<typeof closedAgreementFixture>>
) {
  const lines = await f.db
    .selectFrom("salesInvoiceLine")
    .select(["invoiceId", "rentalBillingPeriodId", "rentalAgreementChargeId"])
    .where("companyId", "=", f.companyId)
    .where("rentalAgreementId", "=", f.agreementId)
    .execute();
  return {
    rent: lines.find((l) => l.rentalBillingPeriodId === f.periodId)?.invoiceId,
    charge: lines.find((l) => l.rentalAgreementChargeId === f.chargeId)
      ?.invoiceId
  };
}
