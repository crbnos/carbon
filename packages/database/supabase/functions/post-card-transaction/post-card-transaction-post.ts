import { parseDate } from "@internationalized/date";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import type { Selectable, Transaction } from "kysely";
import type { DB } from "../lib/database.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import {
  buildCardTransactionJournal,
  type GLAccountClass,
} from "./build-card-transaction-journal.ts";

export type CardTransactionContext = {
  trx: Transaction<DB>;
  cardTransaction: Selectable<DB["cardTransaction"]>;
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

const MONTH_NUMBER: Record<string, number> = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
};

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function monthEnd(year: number, month: number): number {
  const days = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  if (!days) throw new Error("Invalid accounting period month");
  return days;
}

function fiscalCoordinates(
  year: number,
  month: number,
  startMonth: number,
): { fiscalYear: number; periodNumber: number } {
  return {
    fiscalYear: startMonth === 1 || month < startMonth ? year : year + 1,
    periodNumber: ((month - startMonth + 12) % 12) + 1,
  };
}

type PeriodMode = "historical-with-shift" | "current";

/** Resolve and lock the period used by the journal without leaving the transaction. */
export async function resolveCardTransactionPeriod(
  trx: Transaction<DB>,
  companyId: string,
  requestedDate: string,
  mode: PeriodMode,
): Promise<{ id: string; postingDate: string }> {
  let period = await trx.selectFrom("accountingPeriod").select([
    "id",
    "startDate",
    "status",
    "closeStatus",
    "closedAt",
  ]).where("companyId", "=", companyId)
    .where("startDate", "<=", requestedDate)
    .where("endDate", ">=", requestedDate)
    .orderBy("startDate")
    .orderBy("id")
    .forUpdate()
    .executeTakeFirst();

  const isClosed = period &&
    (period.closeStatus === "Locked" || period.closeStatus === "Closed" ||
      period.closedAt !== null);
  if (isClosed && mode === "historical-with-shift") {
    period = await trx.selectFrom("accountingPeriod").select([
      "id",
      "startDate",
      "status",
      "closeStatus",
      "closedAt",
    ]).where("companyId", "=", companyId)
      .where("startDate", ">", requestedDate)
      .where("closeStatus", "=", "Open")
      .where("closedAt", "is", null)
      .orderBy("startDate")
      .orderBy("id")
      .forUpdate()
      .executeTakeFirst();
    if (!period) {
      throw new Error("Card transaction accounting period is locked or closed");
    }
  } else if (isClosed) {
    throw new Error("Card transaction accounting period is locked or closed");
  }

  if (!period) {
    const date = parseDate(requestedDate);
    const fiscalSettings = await trx.selectFrom("fiscalYearSettings").select(
      "startMonth",
    ).where("companyId", "=", companyId).executeTakeFirst();
    const startMonth = fiscalSettings?.startMonth
      ? (MONTH_NUMBER[fiscalSettings.startMonth] ?? 1)
      : 1;
    const { fiscalYear, periodNumber } = fiscalCoordinates(
      date.year,
      date.month,
      startMonth,
    );
    const startDate = `${date.year}-${String(date.month).padStart(2, "0")}-01`;
    const endDate = `${date.year}-${String(date.month).padStart(2, "0")}-${
      String(monthEnd(date.year, date.month)).padStart(2, "0")
    }`;
    if (mode === "current") {
      await trx.updateTable("accountingPeriod").set({ status: "Inactive" })
        .where("companyId", "=", companyId)
        .where("status", "=", "Active")
        .execute();
    }
    const inserted = await trx.insertInto("accountingPeriod").values({
      startDate,
      endDate,
      fiscalYear,
      periodNumber,
      status: mode === "current" ? "Active" : "Inactive",
      closeStatus: "Open",
      companyId,
      createdBy: "system",
    }).onConflict((oc) =>
      oc.columns(["companyId", "fiscalYear", "periodNumber"]).doNothing()
    ).returning(["id", "startDate", "status", "closeStatus", "closedAt"])
      .executeTakeFirst();
    period = inserted ?? await trx.selectFrom("accountingPeriod").select([
      "id",
      "startDate",
      "status",
      "closeStatus",
      "closedAt",
    ]).where("companyId", "=", companyId)
      .where("fiscalYear", "=", fiscalYear)
      .where("periodNumber", "=", periodNumber)
      .forUpdate()
      .executeTakeFirst();
    if (!period) throw new Error("Failed to create card transaction period");
    if (
      period.closeStatus === "Locked" || period.closeStatus === "Closed" ||
      period.closedAt !== null
    ) {
      throw new Error("Card transaction accounting period is locked or closed");
    }
  }

  if (mode === "current" && period.status !== "Active") {
    await trx.updateTable("accountingPeriod").set({ status: "Inactive" })
      .where("companyId", "=", companyId)
      .where("status", "=", "Active")
      .execute();
    await trx.updateTable("accountingPeriod").set({ status: "Active" })
      .where("id", "=", period.id)
      .where("companyId", "=", companyId)
      .execute();
  }

  return {
    id: period.id,
    postingDate:
      mode === "historical-with-shift" && period.startDate > requestedDate
        ? period.startDate
        : requestedDate,
  };
}

function isAccountClass(value: string | null): value is GLAccountClass {
  return value === "Asset" || value === "Liability" || value === "Equity" ||
    value === "Revenue" || value === "Expense";
}

export async function postCardTransaction(
  context: CardTransactionContext,
): Promise<{ journalId: string | null }> {
  const {
    trx,
    cardTransaction,
    company,
    accountingEnabled,
    companyId,
    userId,
    timestamp,
  } = context;
  const lines = await trx.selectFrom("cardTransactionLine").selectAll()
    .where("cardTransactionId", "=", cardTransaction.id)
    .where("companyId", "=", companyId)
    .orderBy("sequence")
    .orderBy("id")
    .forUpdate()
    .execute();
  const accountIds = [
    ...new Set([
      cardTransaction.cardAccountId,
      ...(cardTransaction.offsetAccountId
        ? [cardTransaction.offsetAccountId]
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
      "Card transaction accounts must be active posting accounts in this company group",
    );
  }
  const accounts: Record<string, { class: GLAccountClass }> = {};
  for (const account of postingAccounts) {
    if (!isAccountClass(account.class)) {
      throw new Error("Card transaction account class is missing");
    }
    accounts[account.id] = { class: account.class };
  }
  if (accounts[cardTransaction.cardAccountId]?.class !== "Liability") {
    throw new Error(
      "Card transaction card account must be a Liability account",
    );
  }
  if (
    cardTransaction.type === "Payment" && cardTransaction.offsetAccountId &&
    accounts[cardTransaction.offsetAccountId]?.class !== "Asset"
  ) {
    throw new Error("Card payment offset account must be an Asset account");
  }
  if (
    cardTransaction.type === "Cashback" && cardTransaction.offsetAccountId &&
    accounts[cardTransaction.offsetAccountId]?.class !== "Revenue"
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
      throw new Error("Card transaction cost center not found in this company");
    }
  }

  let postingDate = cardTransaction.postingDate ??
    cardTransaction.transactionDate;
  let journalId: string | null = null;
  if (accountingEnabled) {
    const period = await resolveCardTransactionPeriod(
      trx,
      companyId,
      postingDate,
      "historical-with-shift",
    );
    postingDate = period.postingDate;
    const built = buildCardTransactionJournal({
      transaction: {
        type: cardTransaction.type,
        amount: Number(cardTransaction.amount),
        cardAccountId: cardTransaction.cardAccountId,
        offsetAccountId: cardTransaction.offsetAccountId,
        currencyCode: cardTransaction.currencyCode,
        exchangeRate: Number(cardTransaction.exchangeRate),
      },
      lines: lines.map((line) => ({
        accountId: line.accountId,
        amount: Number(line.amount),
        costCenterId: line.costCenterId,
        description: line.description,
      })),
      accounts,
      documentId: cardTransaction.id,
      documentReadableId: cardTransaction.cardTransactionId,
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

    const journal = await trx.insertInto("journal").values({
      journalEntryId: await getNextSequence(trx, "journalEntry", companyId),
      accountingPeriodId: period.id,
      description: `Card Transaction ${cardTransaction.cardTransactionId}`,
      postingDate,
      companyId,
      sourceType: "Card Transaction",
      status: "Posted",
      postedAt: timestamp,
      postedBy: userId,
      createdBy: userId,
    }).returning("id").executeTakeFirstOrThrow();
    const createdJournalId = journal.id;
    journalId = createdJournalId;
    const journalLineReference = nanoid();
    const insertedLines = await trx.insertInto("journalLine").values(
      built.journalLines.map((line) => ({
        journalId: createdJournalId,
        accountId: line.accountId,
        amount: line.amount,
        quantity: 1,
        description: line.description,
        documentType: "Card Transaction" as const,
        documentId: line.documentId,
        journalLineReference,
        companyId,
      })),
    ).returning("id").execute();
    if (costCenterDimensionId) {
      const dimensionValues = built.journalLines.flatMap((line, index) => {
        const journalLineId = insertedLines[index]?.id;
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
  }

  await trx.updateTable("cardTransaction").set({
    status: "Posted",
    journalId,
    postingDate,
    postedAt: timestamp,
    postedBy: userId,
    updatedAt: timestamp,
    updatedBy: userId,
  }).where("id", "=", cardTransaction.id)
    .where("companyId", "=", companyId)
    .execute();
  return { journalId };
}
