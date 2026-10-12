// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A live-database company with the lessee lease accounts mapped, an accounting
// cutover of 2026-01-01, and one Draft lease with its assets and their payment
// rows. Each asset defaults to the spec's worked example (36 months from
// 2027-01-01, 10,000 a month in arrears, 6 %, no escalation).

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { generateLeasePayments } from "@carbon/utils";
import type { Insertable } from "kysely";
import { sql } from "kysely";
import { connectLocalTestDatabase } from "../local-database-test-fixture";
import { ServerFnContext } from "../server-fn-context";

const USER = "system";

export type LeaseFixtureAsset = {
  paymentAmount?: number; // default 10,000
  fairValue?: number | null;
  economicLifeMonths?: number | null;
  purchaseOptionAmount?: number | null;
  purchaseOptionReasonablyCertain?: boolean;
  ownershipTransfers?: boolean;
  serialNumber?: string | null;
};

export type LeaseFixtureOptions = LeaseFixtureAsset & {
  /** Default 2027-01-01; it is also the invoice-from date. */
  commencementDate?: string;
  /** Default 2029-12-31; null is open-ended (rows cut through 2027-03-01). */
  endDate?: string | null;
  timing?: "Advance" | "Arrears"; // default Arrears
  annualEscalationPercent?: number; // default 0
  /** The leased assets; default one, from the asset options above. */
  assets?: LeaseFixtureAsset[];
};

export type LeaseFixtureAccount =
  | "other"
  | "rou"
  | "accumulated"
  | "liability"
  | "opex"
  | "amortization"
  | "interest"
  | "gain"
  | "loss"
  | "ppe";

export async function leaseFixture(options: LeaseFixtureOptions = {}): Promise<{
  db: Kysely<KyselyDatabase>;
  ctx: ServerFnContext;
  companyId: string;
  leaseId: string;
  /** The `leaseLine` ids, in the order of `assets`. */
  lineIds: string[];
  supplierId: string;
  assetClassId: string;
  accounts: Record<LeaseFixtureAccount, string>;
  cleanup(): Promise<void>;
}> {
  const commencementDate = options.commencementDate ?? "2027-01-01";
  const endDate =
    options.endDate === undefined ? "2029-12-31" : options.endDate;
  const timing = options.timing ?? "Arrears";
  const annualEscalationPercent = options.annualEscalationPercent ?? 0;
  const db = await connectLocalTestDatabase();
  const prefix = `leasefx-${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const supplierId = `${prefix}-supplier`;
  const locationId = `${prefix}-location`;
  const assetClassId = `${prefix}-class`;
  const leaseId = `${prefix}-lease`;
  const assets = options.assets ?? [options];
  const lineIds = assets.map((_, index) => `${prefix}-line-${index}`);

  const accountSpecs = {
    other: "Asset",
    rou: "Asset",
    accumulated: "Asset",
    liability: "Liability",
    opex: "Expense",
    amortization: "Expense",
    interest: "Expense",
    gain: "Revenue",
    loss: "Expense",
    ppe: "Asset"
  } as const;
  const accounts = Object.fromEntries(
    Object.keys(accountSpecs).map((key) => [key, `${prefix}-acct-${key}`])
  ) as Record<keyof typeof accountSpecs, string>;

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
      .values({ id: companyId, accountingCutoverDate: "2026-01-01" })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({ accountingCutoverDate: "2026-01-01" })
      )
      .execute();
    await trx
      .insertInto("sequence")
      .values([
        { table: "lease", name: "Lease", prefix: "LSE", companyId },
        { table: "leaseRun", name: "Lease Run", prefix: "LR", companyId },
        { table: "fixedAsset", name: "Fixed Asset", prefix: "FA", companyId },
        {
          table: "purchaseInvoice",
          name: "Purchase Invoice",
          prefix: "PI",
          companyId
        },
        {
          table: "journalEntry",
          name: "Journal Entry",
          prefix: "JE-",
          companyId
        }
      ])
      .execute();
    await trx
      .insertInto("supplier")
      .values({ id: supplierId, name: prefix, companyId })
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
      .insertInto("account")
      .values(
        Object.entries(accountSpecs).map(([key, accountClass]) => ({
          id: accounts[key as keyof typeof accountSpecs],
          name: `${prefix} ${key}`,
          class: accountClass,
          incomeBalance:
            accountClass === "Asset" || accountClass === "Liability"
              ? ("Balance Sheet" as const)
              : ("Income Statement" as const),
          companyGroupId: groupId,
          createdBy: USER
        }))
      )
      .execute();

    // Every account default points at `other`; the lessee ones at their own.
    const accountColumns = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'accountDefault'
        AND column_name LIKE '%Account'`.execute(trx);
    await trx
      .insertInto("accountDefault")
      .values({
        companyId,
        ...Object.fromEntries(
          accountColumns.rows.map((row) => [row.column_name, accounts.other])
        ),
        rightOfUseAssetAccount: accounts.rou,
        accumulatedRightOfUseAmortizationAccount: accounts.accumulated,
        leaseLiabilityAccount: accounts.liability,
        operatingLeaseExpenseAccount: accounts.opex,
        variableLeaseExpenseAccount: accounts.opex,
        rightOfUseAmortizationExpenseAccount: accounts.amortization,
        leaseInterestExpenseAccount: accounts.interest,
        assetGainOnDisposalAccount: accounts.gain,
        assetLossOnDisposalAccount: accounts.loss
      } as unknown as Insertable<KyselyDatabase["accountDefault"]>)
      .execute();

    await trx
      .insertInto("fixedAssetClass")
      .values({
        id: assetClassId,
        name: "Machinery",
        assetAccountId: accounts.ppe,
        accumulatedDepreciationAccountId: accounts.ppe,
        depreciationExpenseAccountId: accounts.other,
        writeOffAccountId: accounts.other,
        writeDownAccountId: accounts.other,
        lossOnDisposalAccountId: accounts.loss,
        gainOnDisposalAccountId: accounts.gain,
        companyId,
        createdBy: USER
      })
      .execute();

    await trx
      .insertInto("lease")
      .values({
        id: leaseId,
        leaseId: "LSE-TEST",
        name: "Forklift FL-12",
        supplierId,
        locationId,
        commencementDate,
        endDate,
        invoiceFromDate: commencementDate,
        paymentFrequency: "Monthly",
        paymentTiming: timing,
        annualEscalationPercent,
        discountRate: 6,
        currencyCode: "USD",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("leaseLine")
      .values(
        assets.map((asset, index) => ({
          id: lineIds[index],
          leaseId,
          description: `Forklift FL-${12 + index}`,
          paymentAmount: asset.paymentAmount ?? 10000,
          fairValue: asset.fairValue ?? null,
          economicLifeMonths: asset.economicLifeMonths ?? null,
          purchaseOptionAmount: asset.purchaseOptionAmount ?? null,
          purchaseOptionReasonablyCertain:
            asset.purchaseOptionReasonablyCertain ?? false,
          ownershipTransfers: asset.ownershipTransfers ?? false,
          serialNumber: asset.serialNumber ?? null,
          sortOrder: index + 1,
          companyId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("leasePayment")
      .values(
        assets.flatMap((asset, index) =>
          generateLeasePayments({
            commencementDate,
            endDate,
            through: endDate ? undefined : "2027-03-01",
            paymentAmount: asset.paymentAmount ?? 10000,
            frequency: "Monthly",
            timing,
            annualEscalationPercent,
            purchaseOptionAmount: asset.purchaseOptionReasonablyCertain
              ? (asset.purchaseOptionAmount ?? 0)
              : 0,
            decimals: 2
          }).map((row) => ({
            ...row,
            leaseId,
            leaseLineId: lineIds[index]!,
            status: "Pending" as const,
            companyId,
            createdBy: USER
          }))
        )
      )
      .execute();
  });

  const ctx = ServerFnContext.system({ db, companyId, userId: USER });

  return {
    db,
    ctx,
    companyId,
    leaseId,
    lineIds,
    supplierId,
    assetClassId,
    accounts,
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        // Run lines hold their schedule rows ON DELETE RESTRICT.
        await trx
          .deleteFrom("revenueRecognitionRun")
          .where("companyId", "=", companyId)
          .execute();
        // Posted journals are immutable: step them back to Draft first, as
        // the charge fixture does.
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx
          .updateTable("journal")
          .set({ status: "Draft" })
          .where("companyId", "=", companyId)
          .execute();
        await sql`SET LOCAL session_replication_role = origin`.execute(trx);
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

/** Marks the lease run rows dated on or before `through` Posted, as a posted
 *  lease run would. */
export async function postScheduleThrough(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; leaseId: string; through: string }
): Promise<void> {
  await db
    .updateTable("revenueRecognitionSchedule")
    .set({ status: "Posted" })
    .where("companyId", "=", args.companyId)
    .where("leaseId", "=", args.leaseId)
    .where("scheduledDate", "<=", args.through)
    .execute();
}
