// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Posting a rental shipment against the live database: the ticked units go On
// Rent on the delivery date, nothing moves in stock, and the refusals name the
// unit.

import type { KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import { type Insertable, sql } from "kysely";
import { expect } from "vitest";
import create from "../create";
import { databaseTest } from "../local-database-test-fixture";
import { rentalFixture } from "../post-rental-agreement/rental-test-fixture";
import { synthesizeRentalAccruals } from "../propose-revenue-recognition-run";
import postShipment from "./index";

type Fixture = Awaited<ReturnType<typeof rentalFixture>>;

const TIME_ZONE = "America/New_York";

async function draftShipment(f: Fixture): Promise<string> {
  const result = await create(f.ctx, {
    type: "shipmentFromRentalAgreement",
    rentalAgreementId: f.agreementId
  });
  if (result.error) throw result.error;
  return result.data.id;
}

function post(f: Fixture, shipmentId: string, postingDate?: string) {
  return postShipment(f.ctx, { type: "post", shipmentId, postingDate });
}

async function setShipped(
  f: Fixture,
  shipmentId: string,
  lineIds: string[],
  shipped: boolean
) {
  await f.db
    .updateTable("shipmentFixedAssetLine")
    .set({ shipped })
    .where("shipmentId", "=", shipmentId)
    .where("rentalAgreementLineId", "in", lineIds)
    .where("companyId", "=", f.companyId)
    .execute();
}

function shipmentStatus(f: Fixture, shipmentId: string) {
  return f.db
    .selectFrom("shipment")
    .select([
      "status",
      sql<string | null>`"postingDate"::text`.as("postingDate")
    ])
    .where("id", "=", shipmentId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
}

async function countRows(
  f: Fixture,
  table: "itemLedger" | "costLedger" | "journalLine"
): Promise<number> {
  const row = await f.db
    .selectFrom(table)
    .select(sql<number>`count(*)::int`.as("count"))
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

databaseTest(
  "a rental shipment puts the ticked units On Rent on the delivery date and moves no stock",
  async () => {
    const f = await rentalFixture({ units: 5 });
    try {
      const shipmentId = await draftShipment(f);
      const [metered, , , unticked1, unticked2] = f.lineIds as [
        string,
        string,
        string,
        string,
        string
      ];
      await setShipped(f, shipmentId, [unticked1, unticked2], false);
      await f.db
        .updateTable("shipmentFixedAssetLine")
        .set({ meter: 120 })
        .where("shipmentId", "=", shipmentId)
        .where("rentalAgreementLineId", "=", metered)
        .where("companyId", "=", f.companyId)
        .execute();
      const deliveredOn = datetime
        .today(TIME_ZONE)
        .subtract({ days: 3 })
        .toString();

      const result = await post(f, shipmentId, deliveredOn);
      expect(result.error).toBeNull();

      const lines = await f.db
        .selectFrom("rentalAgreementLine")
        .select([
          "id",
          "status",
          "meterOut",
          sql<string | null>`"deliveredAt"::text`.as("deliveredAt")
        ])
        .where("rentalAgreementId", "=", f.agreementId)
        .where("companyId", "=", f.companyId)
        .execute();
      const onRent = lines.filter((line) => line.status === "On Rent");
      expect(onRent).toHaveLength(3);
      expect(onRent.every((line) => line.deliveredAt === deliveredOn)).toBe(
        true
      );
      expect(
        onRent.filter((line) => Number(line.meterOut) === 120).map((l) => l.id)
      ).toEqual([metered]);
      expect(
        lines
          .filter((line) => line.status === "Pending")
          .map((line) => line.id)
          .sort()
      ).toEqual([unticked1, unticked2].sort());
      expect(await shipmentStatus(f, shipmentId)).toEqual({
        status: "Posted",
        postingDate: deliveredOn
      });

      expect(await countRows(f, "itemLedger")).toBe(0);
      expect(await countRows(f, "costLedger")).toBe(0);
      expect(await countRows(f, "journalLine")).toBe(0);
      const activities = await f.db
        .selectFrom("trackedActivity")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("companyId", "=", f.companyId)
        .where("type", "=", "Rental Delivery")
        .executeTakeFirstOrThrow();
      expect(Number(activities.count)).toBe(3);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a rental delivery is never dated in the future", async () => {
  const f = await rentalFixture({ units: 5 });
  try {
    const shipmentId = await draftShipment(f);
    const tomorrow = datetime.today(TIME_ZONE).add({ days: 1 }).toString();
    const result = await post(f, shipmentId, tomorrow);
    expect(result.error?.message).toContain(
      "The delivery date cannot be in the future"
    );
    expect((await shipmentStatus(f, shipmentId)).status).toEqual("Draft");
  } finally {
    await f.cleanup();
  }
});

databaseTest("an out-of-service unit is not delivered", async () => {
  const f = await rentalFixture({ units: 5 });
  try {
    const shipmentId = await draftShipment(f);
    await f.db
      .updateTable("fixedAsset")
      .set({
        outOfServiceSince: "2026-09-01",
        outOfServiceReason: "Hydraulic leak"
      })
      .where("id", "=", f.fixedAssetIds[0]!)
      .where("companyId", "=", f.companyId)
      .execute();
    const result = await post(f, shipmentId);
    expect(result.error?.message).toContain("Hydraulic leak");
  } finally {
    await f.cleanup();
  }
});

databaseTest("a unit already On Rent is not delivered again", async () => {
  const f = await rentalFixture({ units: 5 });
  try {
    const shipmentId = await draftShipment(f);
    await f.db
      .updateTable("rentalAgreementLine")
      .set({ status: "On Rent", deliveredAt: "2026-09-01" })
      .where("id", "=", f.lineIds[0]!)
      .where("companyId", "=", f.companyId)
      .execute();
    const result = await post(f, shipmentId);
    expect(result.error?.message).toContain("FA-");
    expect(result.error?.message).toContain("is On Rent");
  } finally {
    await f.cleanup();
  }
});

databaseTest("a rental shipment with no ticked unit is refused", async () => {
  const f = await rentalFixture({ units: 5 });
  try {
    const shipmentId = await draftShipment(f);
    await setShipped(f, shipmentId, f.lineIds, false);
    const result = await post(f, shipmentId);
    expect(result.error?.message).toContain(
      "Select at least one unit to deliver"
    );
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a backdated delivery accrues from the delivery date in its own month",
  async () => {
    const f = await rentalFixture({ billingTiming: "Arrears" });
    try {
      await f.db
        .updateTable("rentalBillingPeriod")
        .set({ status: "Pending" })
        .where("rentalAgreementLineId", "=", f.lineIds[0]!)
        .where("companyId", "=", f.companyId)
        .execute();

      // The accrual reads the Contract Assets and Rental Income defaults;
      // every account default points at the fixture's one account.
      const assetClass = await f.db
        .selectFrom("fixedAssetClass")
        .select("assetAccountId")
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      const accountColumns = await sql<{ column_name: string }>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'accountDefault'
          AND column_name LIKE '%Account'`.execute(f.db);
      await f.db
        .insertInto("accountDefault")
        .values({
          companyId: f.companyId,
          ...Object.fromEntries(
            accountColumns.rows.map((row) => [
              row.column_name,
              assetClass.assetAccountId
            ])
          )
        } as unknown as Insertable<KyselyDatabase["accountDefault"]>)
        .execute();

      const shipmentId = await draftShipment(f);
      const result = await post(f, shipmentId, "2026-09-25");
      expect(result.error).toBeNull();

      const accrue = (periodEnd: string) =>
        f.db.transaction().execute((trx) =>
          synthesizeRentalAccruals(trx, {
            companyId: f.companyId,
            periodEnd,
            userId: "system"
          })
        );
      const septemberAccruals = async () =>
        (
          await f.db
            .selectFrom("revenueRecognitionSchedule")
            .select([
              sql<string>`"periodStart"::text`.as("periodStart"),
              sql<string>`"periodEnd"::text`.as("periodEnd")
            ])
            .where("companyId", "=", f.companyId)
            .where("type", "=", "Accrual")
            .execute()
        ).filter((row) => row.periodStart.startsWith("2026-09"));

      await accrue("2026-10-31");
      expect(await septemberAccruals()).toEqual([]);

      await accrue("2026-09-30");
      expect(await septemberAccruals()).toEqual([
        { periodStart: "2026-09-25", periodEnd: "2026-09-30" }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

function voidShipment(f: Fixture, shipmentId: string) {
  return postShipment(f.ctx, { type: "void", shipmentId });
}

databaseTest(
  "a voided rental shipment puts its units back to Pending",
  async () => {
    const f = await rentalFixture({ units: 5 });
    try {
      const shipmentId = await draftShipment(f);
      expect((await post(f, shipmentId)).error).toBeNull();

      const result = await voidShipment(f, shipmentId);
      expect(result.error).toBeNull();

      const lines = await f.db
        .selectFrom("rentalAgreementLine")
        .select(["status", "deliveredAt", "meterOut"])
        .where("rentalAgreementId", "=", f.agreementId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(lines).toHaveLength(5);
      for (const line of lines) {
        expect(line).toEqual({
          status: "Pending",
          deliveredAt: null,
          meterOut: null
        });
      }
      expect((await shipmentStatus(f, shipmentId)).status).toEqual("Voided");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a rental shipment does not void over a posted accrual",
  async () => {
    const f = await rentalFixture({ units: 5 });
    try {
      const shipmentId = await draftShipment(f);
      expect((await post(f, shipmentId)).error).toBeNull();
      const assetClass = await f.db
        .selectFrom("fixedAssetClass")
        .select("assetAccountId")
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      await f.db
        .insertInto("revenueRecognitionSchedule")
        .values({
          companyId: f.companyId,
          type: "Accrual",
          status: "Posted",
          rentalAgreementLineId: f.lineIds[0]!,
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          scheduledDate: "2026-09-30",
          amount: 300,
          debitAccountId: assetClass.assetAccountId,
          creditAccountId: assetClass.assetAccountId,
          createdBy: "system"
        })
        .execute();

      const result = await voidShipment(f, shipmentId);
      expect(result.error?.message).toContain(
        "A posted revenue recognition run holds accrued rent for FA-"
      );
      expect((await shipmentStatus(f, shipmentId)).status).toEqual("Posted");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a rental shipment does not void once a unit is returned",
  async () => {
    const f = await rentalFixture({ units: 5 });
    try {
      const shipmentId = await draftShipment(f);
      expect((await post(f, shipmentId)).error).toBeNull();
      await f.db
        .updateTable("rentalAgreementLine")
        .set({ status: "Returned" })
        .where("id", "=", f.lineIds[0]!)
        .where("companyId", "=", f.companyId)
        .execute();

      const result = await voidShipment(f, shipmentId);
      expect(result.error?.message).toContain("is Returned");
    } finally {
      await f.cleanup();
    }
  }
);
