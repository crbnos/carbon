// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Posting a rental receipt against the live database: the ticked units come
// back on the return date at the receipt's location, a Pending unit can come
// back too, and a posted rental receipt is never voided.

import type { KyselyDatabase } from "@carbon/database/client";
import { type Insertable, sql } from "kysely";
import { expect } from "vitest";
import create from "../create";
import { databaseTest } from "../local-database-test-fixture";
import { FILLER_ACCOUNT_DEFAULTS } from "../post-reimbursement/post-reimbursement-test-fixture";
import { rentalFixture } from "../post-rental-agreement/rental-test-fixture";
import postReceipt from "./index";

type Fixture = Awaited<ReturnType<typeof rentalFixture>>;

async function putOnRent(f: Fixture, lineIds: string[]) {
  await f.db
    .updateTable("rentalAgreementLine")
    .set({ status: "On Rent", deliveredAt: "2026-09-01" })
    .where("id", "in", lineIds)
    .where("companyId", "=", f.companyId)
    .execute();
}

async function draftReceipt(f: Fixture): Promise<string> {
  const result = await create(f.ctx, {
    type: "receiptFromRentalAgreement",
    rentalAgreementId: f.agreementId
  });
  if (result.error) throw result.error;
  return result.data.id;
}

function post(f: Fixture, receiptId: string, postingDate?: string) {
  return postReceipt(f.ctx, { type: "post", receiptId, postingDate });
}

async function setReceived(
  f: Fixture,
  receiptId: string,
  lineIds: string[],
  received: boolean
) {
  await f.db
    .updateTable("receiptFixedAssetLine")
    .set({ received })
    .where("receiptId", "=", receiptId)
    .where("rentalAgreementLineId", "in", lineIds)
    .where("companyId", "=", f.companyId)
    .execute();
}

async function setAssetLine(
  f: Fixture,
  receiptId: string,
  lineId: string,
  values: {
    meter?: number;
    takeOutOfService?: boolean;
    outOfServiceReason?: string;
    residualDestination?: string | null;
  }
) {
  await f.db
    .updateTable("receiptFixedAssetLine")
    .set(values)
    .where("receiptId", "=", receiptId)
    .where("rentalAgreementLineId", "=", lineId)
    .where("companyId", "=", f.companyId)
    .execute();
}

async function setReceiptLocation(
  f: Fixture,
  receiptId: string,
  locationId: string
) {
  await f.db
    .updateTable("receipt")
    .set({ locationId })
    .where("id", "=", receiptId)
    .where("companyId", "=", f.companyId)
    .execute();
}

function receiptStatus(f: Fixture, receiptId: string) {
  return f.db
    .selectFrom("receipt")
    .select([
      "status",
      sql<string | null>`"postingDate"::text`.as("postingDate")
    ])
    .where("id", "=", receiptId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
}

function readLine(f: Fixture, lineId: string) {
  return f.db
    .selectFrom("rentalAgreementLine")
    .select([
      "status",
      "meterIn",
      sql<string | null>`"returnedAt"::text`.as("returnedAt")
    ])
    .where("id", "=", lineId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
}

async function makeSaleLine(f: Fixture, lineId: string) {
  await f.db
    .updateTable("rentalAgreementLine")
    .set({ lessorClassification: "Sale", initialNetInvestment: 1000 })
    .where("id", "=", lineId)
    .where("companyId", "=", f.companyId)
    .execute();
}

databaseTest(
  "a rental receipt returns the ticked unit at the receipt's location, out of service",
  async () => {
    const f = await rentalFixture({ units: 3 });
    try {
      await putOnRent(f, f.lineIds);
      const [returned, kept1, kept2] = f.lineIds as [string, string, string];
      const receiptId = await draftReceipt(f);
      await setReceived(f, receiptId, [kept1, kept2], false);
      await setAssetLine(f, receiptId, returned, {
        meter: 130,
        takeOutOfService: true,
        outOfServiceReason: "Hydraulic leak"
      });
      await setReceiptLocation(f, receiptId, f.otherLocationId);

      const result = await post(f, receiptId, "2026-09-20");
      expect(result.error).toBeNull();

      const line = await readLine(f, returned);
      expect(line.status).toEqual("Returned");
      expect(line.returnedAt).toEqual("2026-09-20");
      expect(Number(line.meterIn)).toEqual(130);

      const asset = await f.db
        .selectFrom("fixedAsset")
        .select("locationId")
        .where("id", "=", f.fixedAssetIds[0]!)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(asset.locationId).toEqual(f.otherLocationId);

      const fleet = await f.db
        .selectFrom("fleetAssets")
        .select("fleetStatus")
        .where("id", "=", f.fixedAssetIds[0]!)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(fleet.fleetStatus).toEqual("In Maintenance");

      const activities = await f.db
        .selectFrom("trackedActivity")
        .select(sql<number>`count(*)::int`.as("count"))
        .where("companyId", "=", f.companyId)
        .where("type", "=", "Rental Return")
        .executeTakeFirstOrThrow();
      expect(Number(activities.count)).toBe(1);

      expect(await receiptStatus(f, receiptId)).toEqual({
        status: "Posted",
        postingDate: "2026-09-20"
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a rental receipt with no ticked unit is refused", async () => {
  const f = await rentalFixture({ units: 3 });
  try {
    await putOnRent(f, f.lineIds);
    const receiptId = await draftReceipt(f);
    await setReceived(f, receiptId, f.lineIds, false);
    const result = await post(f, receiptId, "2026-09-20");
    expect(result.error?.message).toContain(
      "Select at least one unit to return"
    );
    expect((await receiptStatus(f, receiptId)).status).toEqual("Draft");
  } finally {
    await f.cleanup();
  }
});

databaseTest("a posted rental receipt is never voided", async () => {
  const f = await rentalFixture({ units: 3 });
  try {
    await putOnRent(f, f.lineIds);
    const receiptId = await draftReceipt(f);
    expect((await post(f, receiptId, "2026-09-20")).error).toBeNull();

    const result = await postReceipt(f.ctx, { type: "void", receiptId });
    expect(result.error?.message).toContain(
      "A rental return cannot be voided. Correct the unit by hand."
    );
    expect((await receiptStatus(f, receiptId)).status).toEqual("Posted");
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a unit treated as a sale needs a residual destination",
  async () => {
    const f = await rentalFixture({ units: 3 });
    try {
      await putOnRent(f, f.lineIds);
      const saleLine = f.lineIds[0]!;
      await makeSaleLine(f, saleLine);
      const receiptId = await draftReceipt(f);
      await setReceived(f, receiptId, f.lineIds.slice(1), false);

      const result = await post(f, receiptId, "2026-09-20");
      expect(result.error?.message).toContain(
        "Choose where the returned unit goes: back to the fleet or into inventory"
      );
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a unit treated as a sale returns into stock at the receipt's location",
  async () => {
    const f = await rentalFixture({ units: 3 });
    try {
      await putOnRent(f, f.lineIds);
      const saleLine = f.lineIds[0]!;
      await makeSaleLine(f, saleLine);
      await f.db
        .updateTable("rentalAgreement")
        .set({ endDate: "2026-09-20" })
        .where("id", "=", f.agreementId)
        .where("companyId", "=", f.companyId)
        .execute();
      await f.db
        .insertInto("itemCost")
        .values({
          itemId: f.itemId,
          costingMethod: "FIFO",
          unitCost: 0,
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      // Every account default points at the fixture's one account, except
      // the empty lease defaults.
      const assetClass = await f.db
        .selectFrom("fixedAssetClass")
        .select("assetAccountId")
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      await f.db
        .insertInto("accountDefault")
        .values({
          companyId: f.companyId,
          ...Object.fromEntries(
            FILLER_ACCOUNT_DEFAULTS.map((column) => [
              column,
              assetClass.assetAccountId
            ])
          ),
          payablesAccount: assetClass.assetAccountId
        } as unknown as Insertable<KyselyDatabase["accountDefault"]>)
        .execute();
      const receiptId = await draftReceipt(f);
      await setReceived(f, receiptId, f.lineIds.slice(1), false);
      await setAssetLine(f, receiptId, saleLine, {
        residualDestination: "Inventory"
      });
      await setReceiptLocation(f, receiptId, f.otherLocationId);

      const result = await post(f, receiptId, "2026-09-20");
      expect(result.error).toBeNull();

      const ledger = await f.db
        .selectFrom("itemLedger")
        .select(["entryType", "documentType", "quantity", "locationId"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        ledger.map((row) => ({ ...row, quantity: Number(row.quantity) }))
      ).toEqual([
        {
          entryType: "Positive Adjmt.",
          documentType: "Rental Agreement",
          quantity: 1,
          locationId: f.otherLocationId
        }
      ]);

      // No cutover: the residual return journal is Provisional, has no
      // period, and its empty Net Investment in Leases default is a stand-in
      // line that names the default it wanted.
      const lease = await f.db
        .selectFrom("journal")
        .innerJoin("journalLine", (join) =>
          join
            .onRef("journalLine.journalId", "=", "journal.id")
            .onRef("journalLine.companyId", "=", "journal.companyId")
        )
        .select([
          "journal.status",
          "journal.accountingPeriodId",
          "journalLine.description",
          "journalLine.amount",
          "journalLine.accountDefaultRole"
        ])
        .where("journal.companyId", "=", f.companyId)
        .where("journal.sourceType", "=", "Lease")
        .orderBy("journalLine.description")
        .execute();
      expect(
        lease.map((row) => ({ ...row, amount: Number(row.amount) }))
      ).toEqual([
        {
          status: "Provisional",
          accountingPeriodId: null,
          description: "Net Investment in Leases",
          amount: -1000,
          accountDefaultRole: "netInvestmentInLeasesAccount"
        },
        {
          status: "Provisional",
          accountingPeriodId: null,
          description: "Raw Materials Account",
          amount: 1000,
          accountDefaultRole: null
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a Pending unit comes back on its own receipt and stops billing",
  async () => {
    const f = await rentalFixture({ units: 2 });
    try {
      const [onRentLine, pendingLine] = f.lineIds as [string, string];
      await putOnRent(f, [onRentLine]);

      const first = await draftReceipt(f);
      const pendingAssetLine = await f.db
        .selectFrom("receiptFixedAssetLine")
        .select("received")
        .where("receiptId", "=", first)
        .where("rentalAgreementLineId", "=", pendingLine)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(pendingAssetLine.received).toBe(false);

      expect((await post(f, first, "2026-09-20")).error).toBeNull();
      expect((await readLine(f, onRentLine)).status).toEqual("Returned");
      expect((await readLine(f, pendingLine)).status).toEqual("Pending");

      const second = await draftReceipt(f);
      await setReceived(f, second, [pendingLine], true);
      expect((await post(f, second, "2026-09-25")).error).toBeNull();

      const line = await readLine(f, pendingLine);
      expect(line.status).toEqual("Returned");
      expect(line.returnedAt).toEqual("2026-09-25");
      const laterPending = await f.db
        .selectFrom("rentalBillingPeriod")
        .select("id")
        .where("rentalAgreementLineId", "=", pendingLine)
        .where("companyId", "=", f.companyId)
        .where("status", "=", "Pending")
        .where("periodStart", ">", "2026-09-25")
        .execute();
      expect(laterPending).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);
