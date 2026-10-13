// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A live-database rental agreement for the rental tests: one Active agreement
// that started 2026-09-01, billed monthly, with N serial fleet units on
// Pending lines. September is invoiced, October is not.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import { connectLocalTestDatabase } from "../local-database-test-fixture";
import { ServerFnContext } from "../server-fn-context";

const USER = "system";

export async function rentalFixture(options?: {
  units?: number; // default 1
  billingTiming?: "Advance" | "Arrears"; // default "Advance"
}): Promise<{
  db: Kysely<KyselyDatabase>;
  ctx: ServerFnContext;
  companyId: string;
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
        { table: "shipment", name: "Shipment", prefix: "SHP-", companyId },
        { table: "receipt", name: "Receipt", prefix: "RCV-", companyId },
        { table: "fixedAsset", name: "Fixed Asset", prefix: "FA", companyId },
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
        startDate: "2026-09-01",
        endDate: null,
        billingCycle: "Calendar Month",
        billingTiming,
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
        lineIds.flatMap((lineId) => [
          {
            rentalAgreementLineId: lineId,
            periodStart: "2026-09-01",
            periodEnd: "2026-09-30",
            days: 30,
            amount: 300,
            dueOn: "2026-09-01",
            status: "Invoiced" as const,
            companyId,
            createdBy: USER
          },
          {
            rentalAgreementLineId: lineId,
            periodStart: "2026-10-01",
            periodEnd: "2026-10-31",
            days: 31,
            amount: 300,
            dueOn: "2026-10-01",
            status: "Pending" as const,
            companyId,
            createdBy: USER
          }
        ])
      )
      .execute();
  });

  const ctx = ServerFnContext.system({ db, companyId, userId: USER });

  return {
    db,
    ctx,
    companyId,
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
