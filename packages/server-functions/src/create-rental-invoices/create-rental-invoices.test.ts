// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The rental invoice generator against the live database: a Closed agreement
// whose invoice was voided still bills the rows the void returned to
// unbilled, and amounts priced in the agreement's currency land on the
// invoice line in base currency.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  connectLocalTestDatabase,
  databaseTest
} from "../local-database-test-fixture";
import { ServerFnContext } from "../server-fn-context";
import createRentalInvoices from "./index";

const USER = "system";

async function closedAgreementFixture() {
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
      .values({
        table: "salesInvoice",
        name: "Sales Invoice",
        prefix: "INV-",
        companyId
      })
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
        status: "Closed",
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
        chargeDate: "2026-09-01",
        companyId,
        createdBy: USER
      })
      .execute();
  });

  const ctx = ServerFnContext.system({ db, companyId, userId: USER });

  return {
    db,
    ctx,
    companyId,
    agreementId,
    periodId,
    chargeId,
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
      const result = await createRentalInvoices(f.ctx, { asOf: "2026-10-05" });
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
      const again = await createRentalInvoices(f.ctx, { asOf: "2026-10-05" });
      expect(again.error).toBeNull();
      expect(again.data!.invoices).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  }
);
