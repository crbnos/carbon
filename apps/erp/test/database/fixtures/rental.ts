// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A live-database rental agreement for the rental tests: one Active agreement
// billed monthly at 300, with N serial fleet units on Pending lines. Calendar
// Month (the default) starts 2026-09-01: September is invoiced, October is
// not. Monthly starts 2026-09-07: 7 Sep – 6 Oct is invoiced, 7 Oct – 6 Nov is
// not.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { parseDate } from "@internationalized/date";
import { sql } from "kysely";
import { connectLocalTestDatabase, removeTestRows } from "./local-database";
import type { PostingHandles } from "@carbon/api/postings.server";

const USER = "system";

export async function rentalFixture(options?: {
  units?: number; // default 1
  billingTiming?: "Advance" | "Arrears"; // default "Advance"
  billingCycle?: "Calendar Month" | "Monthly"; // default "Calendar Month"
  /** The agreement's own invoicing mode; default null (the company's). */
  invoiceAutomation?: Database["public"]["Enums"]["invoiceAutomation"] | null;
  /** A fixed term ending on this date (Calendar Month): one Pending period
   *  per month from November through it. Default null (open-ended). */
  endDate?: string;
  /** Unbilled charges on the first unit. Default none. */
  charges?: { chargeDate: string; amount: number }[];
}): Promise<{
  db: Kysely<KyselyDatabase>;
  ctx: PostingHandles;
  companyId: string;
  customerId: string;
  agreementId: string;
  agreementReadableId: string;
  locationId: string;
  otherLocationId: string;
  lineIds: string[];
  fixedAssetIds: string[];
  fixedAssetReadableIds: string[];
  trackedEntityIds: string[];
  itemId: string;
  cleanup(): Promise<void>;
}> {
  const units = options?.units ?? 1;
  const billingTiming = options?.billingTiming ?? "Advance";
  const billingCycle = options?.billingCycle ?? "Calendar Month";
  const invoiceAutomation = options?.invoiceAutomation ?? null;
  const endDate = options?.endDate ?? null;
  const charges = options?.charges ?? [];
  const periods =
    billingCycle === "Monthly"
      ? [
          { start: "2026-09-07", end: "2026-10-06", days: 30 },
          { start: "2026-10-07", end: "2026-11-06", days: 31 }
        ]
      : [
          { start: "2026-09-01", end: "2026-09-30", days: 30 },
          { start: "2026-10-01", end: "2026-10-31", days: 31 }
        ];
  // A fixed term's later months, cut in full as activation cuts them.
  if (endDate !== null) {
    const last = parseDate(endDate);
    let start = parseDate("2026-11-01");
    while (start.compare(last) <= 0) {
      const monthEnd = start.add({ months: 1 }).subtract({ days: 1 });
      const end = monthEnd.compare(last) > 0 ? last : monthEnd;
      periods.push({
        start: start.toString(),
        end: end.toString(),
        days: end.day
      });
      start = start.add({ months: 1 });
    }
  }

  const db = await connectLocalTestDatabase();
  const prefix = `rentfx-${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const accountId = `${prefix}-account`;
  const customerId = `${prefix}-customer`;
  const itemId = `${prefix}-item`;
  const locationId = `${prefix}-location`;
  const otherLocationId = `${prefix}-location-2`;
  const assetClassId = `${prefix}-class`;
  const agreementId = `${prefix}-agreement`;
  const agreementReadableId = "RA-TEST";
  const unitRows = Array.from({ length: units }, (_, i) => {
    const n = i + 1;
    return {
      n,
      lineId: `${prefix}-line-${n}`,
      fixedAssetId: `${prefix}-asset-${n}`,
      fixedAssetReadableId: `FA-${n}`,
      trackedEntityId: `${prefix}-entity-${n}`
    };
  });
  const lineIds = unitRows.map((u) => u.lineId);
  const fixedAssetIds = unitRows.map((u) => u.fixedAssetId);
  const fixedAssetReadableIds = unitRows.map((u) => u.fixedAssetReadableId);
  const trackedEntityIds = unitRows.map((u) => u.trackedEntityId);

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
      .values([
        {
          table: "salesInvoice",
          name: "Sales Invoice",
          prefix: "INV-",
          companyId
        },
        { table: "shipment", name: "Shipment", prefix: "SHP-", companyId },
        { table: "receipt", name: "Receipt", prefix: "RCV-", companyId },
        { table: "fixedAsset", name: "Fixed Asset", prefix: "FA", companyId },
        { table: "creditMemo", name: "Credit Memo", prefix: "CM-", companyId },
        {
          table: "journalEntry",
          name: "Journal Entry",
          prefix: "JE-",
          companyId
        }
      ])
      .execute();
    await trx
      .insertInto("customer")
      .values({ id: customerId, name: prefix, companyId })
      .execute();
    await trx
      .insertInto("location")
      .values(
        [
          { id: locationId, name: "Headquarters" },
          { id: otherLocationId, name: "Yard" }
        ].map((location) => ({
          ...location,
          addressLine1: "1 Main St",
          city: "Springfield",
          postalCode: "00000",
          timezone: "America/New_York",
          companyId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("item")
      .values({
        id: itemId,
        readableId: `${prefix}-LIFT`,
        name: "Scissor lift",
        type: "Part",
        itemTrackingType: "Serial",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("account")
      .values({
        id: accountId,
        name: "Rental fleet",
        incomeBalance: "Balance Sheet",
        companyGroupId: groupId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("fixedAssetClass")
      .values({
        id: assetClassId,
        name: "Rental Fleet",
        assetAccountId: accountId,
        accumulatedDepreciationAccountId: accountId,
        depreciationExpenseAccountId: accountId,
        writeOffAccountId: accountId,
        writeDownAccountId: accountId,
        lossOnDisposalAccountId: accountId,
        gainOnDisposalAccountId: accountId,
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("trackedEntity")
      .values(
        unitRows.map((u) => ({
          id: u.trackedEntityId,
          readableId: `SN-${u.n}`,
          itemId,
          quantity: 1,
          sourceDocument: "Item",
          sourceDocumentId: itemId,
          companyId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("fixedAsset")
      .values(
        unitRows.map((u) => ({
          id: u.fixedAssetId,
          fixedAssetId: u.fixedAssetReadableId,
          name: `Scissor lift ${u.n}`,
          serialNumber: `SN-${u.n}`,
          status: "Active" as const,
          fixedAssetClassId: assetClassId,
          locationId,
          itemId,
          trackedEntityId: u.trackedEntityId,
          companyId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("rentalAgreement")
      .values({
        id: agreementId,
        rentalAgreementId: agreementReadableId,
        customerId,
        locationId,
        currencyCode: "USD",
        discountRate: 0,
        startDate: periods[0]!.start,
        endDate,
        billingCycle,
        billingTiming,
        invoiceAutomation,
        status: "Active",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("rentalAgreementLine")
      .values(
        unitRows.map((u) => ({
          id: u.lineId,
          rentalAgreementId: agreementId,
          itemId,
          fixedAssetId: u.fixedAssetId,
          trackedEntityId: u.trackedEntityId,
          rateUnit: "Month" as const,
          rate: 300,
          lessorClassification: "Rental" as const,
          status: "Pending" as const,
          companyId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("rentalBillingPeriod")
      .values(
        lineIds.flatMap((lineId) =>
          periods.map((period, i) => ({
            rentalAgreementLineId: lineId,
            periodStart: period.start,
            periodEnd: period.end,
            days: period.days,
            amount: 300,
            dueOn: period.start,
            status: i === 0 ? ("Invoiced" as const) : ("Pending" as const),
            companyId,
            createdBy: USER
          }))
        )
      )
      .execute();
    if (charges.length > 0) {
      await trx
        .insertInto("rentalAgreementCharge")
        .values(
          charges.map((charge, i) => ({
            rentalAgreementLineId: lineIds[0]!,
            description: `Charge ${i + 1}`,
            chargeDate: charge.chargeDate,
            amount: charge.amount,
            companyId,
            createdBy: USER
          }))
        )
        .execute();
    }
  });

  const ctx = { db, companyId, userId: USER };

  return {
    db,
    ctx,
    companyId,
    customerId,
    agreementId,
    agreementReadableId,
    locationId,
    otherLocationId,
    lineIds,
    fixedAssetIds,
    fixedAssetReadableIds,
    trackedEntityIds,
    itemId,
    async cleanup() {
      await removeTestRows(db, async (trx) => {
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
