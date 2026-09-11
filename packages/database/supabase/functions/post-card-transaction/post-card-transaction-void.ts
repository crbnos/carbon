import { getNextSequence } from "../shared/get-next-sequence.ts";
import type { CardTransactionContext } from "./post-card-transaction-post.ts";
import { resolveAccountingPeriod } from "../shared/get-accounting-period.ts";

export async function voidCardTransaction(
  context: CardTransactionContext,
): Promise<{ journalId: string | null }> {
  const {
    trx,
    cardTransaction,
    accountingEnabled,
    companyId,
    userId,
    timestamp,
    today,
  } = context;

  if (cardTransaction.journalId) {
    if (!accountingEnabled) {
      throw new Error(
        "Enable accounting before reversing a posted card transaction journal",
      );
    }
    const originalJournal = await trx.selectFrom("journal").select([
      "id",
      "status",
      "sourceType",
    ]).where("id", "=", cardTransaction.journalId)
      .where("companyId", "=", companyId)
      .forShare()
      .executeTakeFirst();
    if (
      !originalJournal || originalJournal.status !== "Posted" ||
      originalJournal.sourceType !== "Card Transaction"
    ) {
      throw new Error(
        "Original card transaction journal has invalid provenance",
      );
    }
    const originalLines = await trx.selectFrom("journalLine").selectAll()
      .where("journalId", "=", originalJournal.id)
      .where("companyId", "=", companyId)
      .orderBy("id")
      .execute();
    if (
      !originalLines.length ||
      originalLines.some((line) =>
        line.documentType !== "Card Transaction" ||
        line.documentId !== cardTransaction.id
      )
    ) {
      throw new Error("Original card transaction journal has invalid lines");
    }
    const period = await resolveAccountingPeriod(
      trx,
      companyId,
      today,
      "current",
    );
    const reversal = await trx.insertInto("journal").values({
      journalEntryId: await getNextSequence(trx, "journalEntry", companyId),
      accountingPeriodId: period.id,
      description: `VOID Card Transaction ${cardTransaction.cardTransactionId}`,
      postingDate: period.postingDate,
      companyId,
      sourceType: "Card Transaction",
      status: "Posted",
      postedAt: timestamp,
      postedBy: userId,
      createdBy: userId,
    }).returning("id").executeTakeFirstOrThrow();
    const reversedLines = await trx.insertInto("journalLine").values(
      originalLines.map((line) => ({
        journalId: reversal.id,
        accountId: line.accountId,
        amount: -Number(line.amount),
        quantity: line.quantity,
        description: `VOID: ${line.description ?? ""}`,
        documentType: "Card Transaction" as const,
        documentId: cardTransaction.id,
        documentLineReference: line.documentLineReference,
        journalLineReference: line.journalLineReference,
        companyId,
      })),
    ).returning("id").execute();
    const dimensions = await trx.selectFrom("journalLineDimension").select([
      "journalLineId",
      "dimensionId",
      "valueId",
    ]).where("companyId", "=", companyId)
      .where("journalLineId", "in", originalLines.map((line) => line.id))
      .execute();
    const reversalByOriginal = new Map(
      originalLines.map((line, index) => [line.id, reversedLines[index]?.id]),
    );
    if (dimensions.length) {
      const reversedDimensions = dimensions.map((dimension) => {
        const journalLineId = reversalByOriginal.get(dimension.journalLineId);
        if (!journalLineId) {
          throw new Error("Failed to map reversed journal line");
        }
        return {
          ...dimension,
          journalLineId,
          companyId,
        };
      });
      await trx.insertInto("journalLineDimension").values(reversedDimensions)
        .execute();
    }
  }

  await trx.updateTable("cardTransaction").set({
    status: "Voided",
    voidedAt: timestamp,
    voidedBy: userId,
    updatedAt: timestamp,
    updatedBy: userId,
  }).where("id", "=", cardTransaction.id)
    .where("companyId", "=", companyId)
    .execute();
  return { journalId: cardTransaction.journalId };
}
