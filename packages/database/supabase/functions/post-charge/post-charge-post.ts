import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import type { Selectable, Transaction } from "kysely";
import type { DB } from "../lib/database.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import { resolveAccountingPeriod } from "../shared/get-accounting-period.ts";
import {
  buildChargeJournal,
  type GLAccountClass,
} from "./build-charge-journal.ts";
import { allocateJournalLineIds } from "./journal-line-ids.ts";

export type ChargeContext = {
  trx: Transaction<DB>;
  charge: Pick<
    Selectable<DB["charge"]>,
    | "id"
    | "chargeId"
    | "type"
    | "status"
    | "amount"
    | "cardAccountId"
    | "offsetAccountId"
    | "currencyCode"
    | "exchangeRate"
    | "transactionDate"
    | "postingDate"
    | "journalId"
  >;
  company: Pick<
    Selectable<DB["company"]>,
    "companyGroupId" | "baseCurrencyCode" | "timezone"
  >;
  accountingEnabled: boolean;
  companyId: string;
  userId: string;
  timestamp: string;
  today: string;
};

function isAccountClass(value: string | null): value is GLAccountClass {
  return value === "Asset" || value === "Liability" || value === "Equity" ||
    value === "Revenue" || value === "Expense";
}

export async function postCharge(
  context: ChargeContext,
): Promise<{ journalId: string | null }> {
  const {
    trx,
    charge,
    company,
    accountingEnabled,
    companyId,
    userId,
    timestamp,
  } = context;
  // The parent lock serializes line writes. Locking line tuples too would
  // deadlock with an UPDATE whose BEFORE trigger is waiting for that parent.
  const lines = await trx.selectFrom("chargeLine").selectAll()
    .where("chargeId", "=", charge.id)
    .where("companyId", "=", companyId)
    .orderBy("sequence")
    .orderBy("id")
    .execute();
  const accountIds = [
    ...new Set([
      charge.cardAccountId,
      ...(charge.offsetAccountId
        ? [charge.offsetAccountId]
        : []),
      ...lines.map((line) => line.accountId),
    ]),
  ];
  const postingAccounts = await trx.selectFrom("account").select([
    "id",
    "class",
  ]).where("id", "in", accountIds)
    .where("companyGroupId", "=", company.companyGroupId)
    .where("active", "=", true)
    .where("isGroup", "=", false)
    .execute();
  if (
    postingAccounts.length !== accountIds.length ||
    postingAccounts.some((account) => !isAccountClass(account.class))
  ) {
    throw new Error(
      "Charge accounts must be active posting accounts in this company group",
    );
  }
  const accounts: Record<string, { class: GLAccountClass }> = {};
  for (const account of postingAccounts) {
    if (!isAccountClass(account.class)) {
      throw new Error("Charge account class is missing");
    }
    accounts[account.id] = { class: account.class };
  }
  if (accounts[charge.cardAccountId]?.class !== "Liability") {
    throw new Error(
      "Charge card account must be a Liability account",
    );
  }
  if (
    charge.type === "Payment" && charge.offsetAccountId &&
    accounts[charge.offsetAccountId]?.class !== "Asset"
  ) {
    throw new Error("Card payment offset account must be an Asset account");
  }
  if (
    charge.type === "Cashback" && charge.offsetAccountId &&
    accounts[charge.offsetAccountId]?.class !== "Revenue"
  ) {
    throw new Error("Card cashback offset account must be a Revenue account");
  }

  const costCenterIds = [
    ...new Set(
      lines.flatMap((line) => line.costCenterId ? [line.costCenterId] : []),
    ),
  ];
  if (costCenterIds.length) {
    const costCenters = await trx.selectFrom("costCenter").select("id")
      .where("companyId", "=", companyId)
      .where("id", "in", costCenterIds)
      .execute();
    if (costCenters.length !== costCenterIds.length) {
      throw new Error("Charge cost center not found in this company");
    }
  }

  const projectIds = [
    ...new Set(
      lines.flatMap((line) => line.projectId ? [line.projectId] : []),
    ),
  ];
  if (projectIds.length) {
    const projects = await trx.selectFrom("project").select("id")
      .where("companyId", "=", companyId)
      .where("id", "in", projectIds)
      .execute();
    if (projects.length !== projectIds.length) {
      throw new Error("Charge project not found in this company");
    }
  }

  let postingDate = charge.postingDate ??
    charge.transactionDate;
  let journalId: string | null = null;
  if (accountingEnabled) {
    const period = await resolveAccountingPeriod(
      trx,
      companyId,
      postingDate,
      "historical-with-shift",
    );
    postingDate = period.postingDate;
    const built = buildChargeJournal({
      transaction: {
        type: charge.type,
        amount: Number(charge.amount),
        cardAccountId: charge.cardAccountId,
        offsetAccountId: charge.offsetAccountId,
        currencyCode: charge.currencyCode,
        exchangeRate: Number(charge.exchangeRate),
      },
      lines: lines.map((line) => ({
        accountId: line.accountId,
        amount: Number(line.amount),
        costCenterId: line.costCenterId,
        projectId: line.projectId,
        description: line.description,
      })),
      accounts,
      documentId: charge.id,
      documentReadableId: charge.chargeId,
    });
    const dimensions = costCenterIds.length
      ? await trx.selectFrom("dimension").select("id")
        .where("companyGroupId", "=", company.companyGroupId)
        .where("active", "=", true)
        .where("entityType", "=", "CostCenter")
        .orderBy("createdAt")
        .orderBy("id")
        .limit(1)
        .execute()
      : [];
    const costCenterDimensionId = dimensions[0]?.id ?? null;
    if (costCenterIds.length && !costCenterDimensionId) {
      throw new Error("Company group has no active Cost Center dimension");
    }
    const projectDimensions = projectIds.length
      ? await trx.selectFrom("dimension").select("id")
        .where("companyGroupId", "=", company.companyGroupId)
        .where("active", "=", true)
        .where("entityType", "=", "Project")
        .orderBy("createdAt")
        .orderBy("id")
        .limit(1)
        .execute()
      : [];
    const projectDimensionId = projectDimensions[0]?.id ?? null;
    if (projectIds.length && !projectDimensionId) {
      throw new Error("Company group has no active Project dimension");
    }

    const journal = await trx.insertInto("journal").values({
      journalEntryId: await getNextSequence(trx, "journalEntry", companyId),
      accountingPeriodId: period.id,
      description: `Charge ${charge.chargeId}`,
      postingDate,
      companyId,
      sourceType: "Charge",
      status: "Posted",
      postedAt: timestamp,
      postedBy: userId,
      createdBy: userId,
    }).returning("id").executeTakeFirstOrThrow();
    const createdJournalId = journal.id;
    journalId = createdJournalId;
    const journalLineReference = nanoid();
    const journalLineIds = await allocateJournalLineIds(
      trx,
      built.journalLines.length,
    );
    await trx.insertInto("journalLine").values(
      built.journalLines.map((line, index) => ({
        id: journalLineIds[index],
        journalId: createdJournalId,
        accountId: line.accountId,
        amount: line.amount,
        quantity: 1,
        description: line.description,
        documentType: "Charge" as const,
        documentId: line.documentId,
        journalLineReference,
        companyId,
      })),
    ).execute();
    if (costCenterDimensionId) {
      const dimensionValues = built.journalLines.flatMap((line, index) => {
        const journalLineId = journalLineIds[index];
        if (!line.costCenterId) return [];
        if (!journalLineId) throw new Error("Failed to map card journal line");
        return [{
          journalLineId,
          dimensionId: costCenterDimensionId,
          valueId: line.costCenterId,
          companyId,
        }];
      });
      if (dimensionValues.length) {
        await trx.insertInto("journalLineDimension").values(dimensionValues)
          .execute();
      }
    }
    if (projectDimensionId) {
      const projectDimensionValues = built.journalLines.flatMap(
        (line, index) => {
          const journalLineId = journalLineIds[index];
          if (!line.projectId) return [];
          if (!journalLineId) throw new Error("Failed to map card journal line");
          return [{
            journalLineId,
            dimensionId: projectDimensionId,
            valueId: line.projectId,
            companyId,
          }];
        },
      );
      if (projectDimensionValues.length) {
        await trx.insertInto("journalLineDimension").values(
          projectDimensionValues,
        ).execute();
      }
    }
  }

  await trx.updateTable("charge").set({
    status: "Posted",
    journalId,
    postingDate,
    postedAt: timestamp,
    postedBy: userId,
    updatedAt: timestamp,
    updatedBy: userId,
  }).where("id", "=", charge.id)
    .where("companyId", "=", companyId)
    .execute();
  return { journalId };
}
