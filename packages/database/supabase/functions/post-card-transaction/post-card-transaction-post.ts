import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import type { Selectable, Transaction } from "kysely";
import type { DB } from "../lib/database.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import { resolveAccountingPeriod } from "../shared/get-accounting-period.ts";
import {
  buildCardTransactionJournal,
  type GLAccountClass,
} from "./build-card-transaction-journal.ts";

export type CardTransactionContext = {
  trx: Transaction<DB>;
  cardTransaction: Pick<
    Selectable<DB["cardTransaction"]>,
    | "id"
    | "cardTransactionId"
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
  // The parent lock serializes line writes. Locking line tuples too would
  // deadlock with an UPDATE whose BEFORE trigger is waiting for that parent.
  const lines = await trx.selectFrom("cardTransactionLine").selectAll()
    .where("cardTransactionId", "=", cardTransaction.id)
    .where("companyId", "=", companyId)
    .orderBy("sequence")
    .orderBy("id")
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
    const period = await resolveAccountingPeriod(
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
