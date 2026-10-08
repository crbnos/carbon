// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Shared by the rental agreement actions and the rental documents: the
// agreement row and its lock, billing-period rows, and the 'Lease' journal
// and traceability writers.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { round } from "@carbon/database/precision";
import {
  buildJournalLineDimensionInserts,
  type PeriodSpec
} from "@carbon/utils";
import { sql, type Transaction } from "kysely";
import { nanoid } from "nanoid";
import { InvalidInputError, NotFoundError } from "../errors";
import { getCurrentAccountingPeriod } from "../lib/get-accounting-period";
import { createAdjustmentJournal } from "../lib/post-adjustment";
import type { PostingLine } from "./lessor";

export type Db = Kysely<KyselyDatabase>;
export type Trx = Transaction<KyselyDatabase>;
export type Enums = Database["public"]["Enums"];

export type AgreementRow = {
  id: string;
  rentalAgreementId: string;
  status: Enums["rentalAgreementStatus"];
  customerId: string;
  locationId: string;
  startDate: string;
  endDate: string | null;
  billingCycle: Enums["rentalBillingCycle"];
  billingTiming: Enums["rentalBillingTiming"];
  currencyCode: string;
  discountRate: number;
  ownershipTransfers: boolean;
  specializedAsset: boolean;
  purchaseOptionAmount: number | null;
  purchaseOptionReasonablyCertain: boolean;
};

// Re-read under the caller's company and lock: the id comes from the payload,
// and the permission check proves nothing about it. The lock serializes two
// actions on one agreement (a double-clicked Activate, a return racing a
// cancel). DATE columns decode to JS Dates through the driver, so they are
// selected as text — the billing math works on `YYYY-MM-DD` strings.
export async function lockAgreement(
  trx: Trx,
  companyId: string,
  id: string
): Promise<AgreementRow> {
  const agreement = await trx
    .selectFrom("rentalAgreement")
    .select([
      "id",
      "rentalAgreementId",
      "status",
      "customerId",
      "locationId",
      sql<string>`"startDate"::text`.as("startDate"),
      sql<string | null>`"endDate"::text`.as("endDate"),
      "billingCycle",
      "billingTiming",
      "currencyCode",
      "discountRate",
      "ownershipTransfers",
      "specializedAsset",
      "purchaseOptionAmount",
      "purchaseOptionReasonablyCertain"
    ])
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!agreement) throw new NotFoundError("Rental agreement not found");
  return {
    ...agreement,
    discountRate: Number(agreement.discountRate),
    purchaseOptionAmount:
      agreement.purchaseOptionAmount === null
        ? null
        : Number(agreement.purchaseOptionAmount)
  };
}

// Billing periods are invoiced, so they are priced at the agreement
// currency's settlement precision — the group's `currency.decimalPlaces`,
// never a literal.
export async function currencyDecimals(
  trx: Trx,
  companyId: string,
  currencyCode: string
): Promise<number> {
  const currency = await trx
    .selectFrom("currency")
    .innerJoin("company", "company.companyGroupId", "currency.companyGroupId")
    .select("currency.decimalPlaces")
    .where("company.id", "=", companyId)
    .where("currency.code", "=", currencyCode)
    .executeTakeFirst();
  if (!currency || currency.decimalPlaces === null) {
    throw new InvalidInputError(
      `Currency ${currencyCode} is not set up for this company`
    );
  }
  return currency.decimalPlaces;
}

export function billingPeriodRow(
  spec: PeriodSpec,
  rentalAgreementLineId: string,
  companyId: string,
  userId: string
) {
  return {
    rentalAgreementLineId,
    periodStart: spec.periodStart,
    periodEnd: spec.periodEnd,
    days: spec.days,
    amount: spec.amount,
    rateUnitApplied: spec.rateUnitApplied,
    isAdjustment: spec.isAdjustment,
    dueOn: spec.dueOn,
    status: "Pending" as const,
    companyId,
    createdBy: userId
  };
}

// What the 'Lease' journals need, resolved once per request inside the
// transaction. The period resolver reuses the caller's transaction and locks
// the period row, so a close cannot slip in between.
export type LeaseAccounting = {
  accountingPeriodId: string;
  accounts: {
    netInvestmentInLeasesAccount: string;
    leaseRevenueAccount: string;
    leaseInterestIncomeAccount: string;
    costOfGoodsSoldAccount: string;
    finishedGoodsAccount: string;
    rawMaterialsAccount: string;
  };
  // active dimensions for the company group, entityType → dimension id
  dimensionMap: Map<string, string>;
};

export async function loadLeaseAccounting(
  trx: Trx,
  args: { companyId: string; companyGroupId: string | null; today: string }
): Promise<LeaseAccounting> {
  const { companyId } = args;
  const defaults = await trx
    .selectFrom("accountDefault")
    .select([
      "netInvestmentInLeasesAccount",
      "leaseRevenueAccount",
      "leaseInterestIncomeAccount",
      "costOfGoodsSoldAccount",
      "finishedGoodsAccount",
      "rawMaterialsAccount"
    ])
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults) throw new Error("Error getting account defaults");
  const {
    netInvestmentInLeasesAccount,
    leaseRevenueAccount,
    leaseInterestIncomeAccount
  } = defaults;
  if (
    !netInvestmentInLeasesAccount ||
    !leaseRevenueAccount ||
    !leaseInterestIncomeAccount
  ) {
    throw new InvalidInputError(
      "Set the Net Investment in Leases, Lease Revenue and Lease Interest Income accounts in the account defaults before activating a rental treated as a sale"
    );
  }

  // Dimensions are configured per company group; a company outside one
  // tags nothing.
  const dimensions =
    args.companyGroupId === null
      ? []
      : await trx
          .selectFrom("dimension")
          .select(["id", "entityType"])
          .where("companyGroupId", "=", args.companyGroupId)
          .where("active", "=", true)
          .where("entityType", "in", ["Customer", "Item", "Location"])
          .execute();

  const accountingPeriodId = await getCurrentAccountingPeriod(
    companyId,
    trx,
    args.today
  );

  return {
    accountingPeriodId,
    accounts: {
      netInvestmentInLeasesAccount,
      leaseRevenueAccount,
      leaseInterestIncomeAccount,
      costOfGoodsSoldAccount: defaults.costOfGoodsSoldAccount,
      finishedGoodsAccount: defaults.finishedGoodsAccount,
      rawMaterialsAccount: defaults.rawMaterialsAccount
    },
    dimensionMap: new Map(
      dimensions.map((dimension) => [dimension.entityType, dimension.id])
    )
  };
}

// One posted 'Lease' journal from already-balanced lines. Every line carries
// the agreement as its document and the agreement line as the line
// reference, tagged with the Customer / Item / Location dimensions the
// company group has active.
export async function postLeaseJournal(
  trx: Trx,
  args: {
    accounting: LeaseAccounting;
    companyId: string;
    userId: string;
    postingDate: string;
    description: string;
    lines: PostingLine[];
    rentalAgreementId: string;
    rentalAgreementLineId: string;
    tags: { customerId: string; itemId: string; locationId: string };
  }
): Promise<string> {
  const { accounting, companyId, userId } = args;
  const journalId = await createAdjustmentJournal(trx, {
    companyId,
    accountingPeriodId: accounting.accountingPeriodId,
    description: args.description,
    postingDate: args.postingDate,
    userId,
    sourceType: "Lease"
  });

  const journalLineReference = nanoid();
  const journalLines = await trx
    .insertInto("journalLine")
    .values(
      args.lines.map((line) => ({
        journalId,
        accountId: line.accountId,
        description: line.description,
        amount: round(line.amount),
        quantity: 1,
        documentType: "Rental Agreement" as const,
        documentId: args.rentalAgreementId,
        documentLineReference: args.rentalAgreementLineId,
        journalLineReference,
        companyId
      }))
    )
    .returning(["id"])
    .execute();

  const dimensionInserts = buildJournalLineDimensionInserts({
    journalLineIds: journalLines.map((line) => line.id),
    meta: journalLines.map(() => args.tags),
    dimensionMap: accounting.dimensionMap,
    companyId
  });
  if (dimensionInserts.length > 0) {
    await trx
      .insertInto("journalLineDimension")
      .values(dimensionInserts)
      .execute();
  }

  return journalId;
}

// The traceability graph records the lease as the consumer of the unit at
// commencement, and as its producer when it comes back to stock.
export async function insertUnitActivity(
  trx: Trx,
  args: {
    type:
      | "Lease Commencement"
      | "Return to Inventory"
      | "Capitalize"
      | "Rental Delivery"
      | "Rental Return"
      | "Void Shipment";
    direction: "input" | "output";
    sourceDocument: "Rental Agreement" | "Fixed Asset" | "Shipment" | "Receipt";
    sourceDocumentId: string;
    sourceDocumentReadableId: string;
    attributes: Record<string, string>;
    trackedEntityId: string;
    companyId: string;
    userId: string;
  }
): Promise<void> {
  const activityId = nanoid();
  await trx
    .insertInto("trackedActivity")
    .values({
      id: activityId,
      type: args.type,
      sourceDocument: args.sourceDocument,
      sourceDocumentId: args.sourceDocumentId,
      sourceDocumentReadableId: args.sourceDocumentReadableId,
      attributes: args.attributes,
      companyId: args.companyId,
      createdBy: args.userId
    })
    .execute();
  await trx
    .insertInto(
      args.direction === "input"
        ? "trackedActivityInput"
        : "trackedActivityOutput"
    )
    .values({
      trackedActivityId: activityId,
      trackedEntityId: args.trackedEntityId,
      quantity: 1,
      companyId: args.companyId,
      createdBy: args.userId
    })
    .execute();
}
