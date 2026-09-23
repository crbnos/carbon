import { getNextSequence } from "../shared/get-next-sequence.ts";
import type { ChargeContext } from "./post-charge-post.ts";
import { resolveAccountingPeriod } from "../shared/get-accounting-period.ts";
import { allocateJournalLineIds } from "./journal-line-ids.ts";

export async function voidCharge(
  context: ChargeContext,
): Promise<{ journalId: string | null }> {
  const {
    trx,
    charge,
    accountingEnabled,
    companyId,
    userId,
    timestamp,
    today,
  } = context;

  if (charge.journalId) {
    if (!accountingEnabled) {
      throw new Error(
        "Enable accounting before reversing a posted charge journal",
      );
    }
    const originalJournal = await trx.selectFrom("journal").select([
      "id",
      "status",
      "sourceType",
    ]).where("id", "=", charge.journalId)
      .where("companyId", "=", companyId)
      .forShare()
      .executeTakeFirst();
    if (
      !originalJournal || originalJournal.status !== "Posted" ||
      originalJournal.sourceType !== "Charge"
    ) {
      throw new Error(
        "Original charge journal has invalid provenance",
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
        line.documentType !== "Charge" ||
        line.documentId !== charge.id
      )
    ) {
      throw new Error("Original charge journal has invalid lines");
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
      description: `VOID Charge ${charge.chargeId}`,
      postingDate: period.postingDate,
      companyId,
      sourceType: "Charge",
      status: "Posted",
      postedAt: timestamp,
      postedBy: userId,
      createdBy: userId,
    }).returning("id").executeTakeFirstOrThrow();
    const reversalLineIds = await allocateJournalLineIds(
      trx,
      originalLines.length,
    );
    await trx.insertInto("journalLine").values(
      originalLines.map((line, index) => ({
        id: reversalLineIds[index],
        journalId: reversal.id,
        accountId: line.accountId,
        amount: -Number(line.amount),
        quantity: line.quantity,
        description: `VOID: ${line.description ?? ""}`,
        documentType: "Charge" as const,
        documentId: charge.id,
        documentLineReference: line.documentLineReference,
        journalLineReference: line.journalLineReference,
        companyId,
      })),
    ).execute();
    const dimensions = await trx.selectFrom("journalLineDimension").select([
      "journalLineId",
      "dimensionId",
      "valueId",
    ]).where("companyId", "=", companyId)
      .where("journalLineId", "in", originalLines.map((line) => line.id))
      .execute();
    const reversalByOriginal = new Map(
      originalLines.map((line, index) => [line.id, reversalLineIds[index]]),
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

  await trx.updateTable("charge").set({
    status: "Voided",
    voidedAt: timestamp,
    voidedBy: userId,
    updatedAt: timestamp,
    updatedBy: userId,
  }).where("id", "=", charge.id)
    .where("companyId", "=", companyId)
    .execute();
  return { journalId: charge.journalId };
}
