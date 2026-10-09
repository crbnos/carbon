// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DOCUMENT_JOURNAL_STATUSES,
  OPEN_ITEM_JOURNAL_STATUSES
} from "@carbon/database/accounting-posting";
import { getNextSequence } from "@carbon/database/sequence";
import { resolveAccountingPeriod } from "../lib/get-accounting-period";
import { allocateJournalLineIds } from "../post-charge/journal-line-ids";
import type { ReimbursementContext } from "./post-reimbursement-post";

export async function voidReimbursement(
  context: ReimbursementContext
): Promise<{ journalId: string | null }> {
  const {
    trx,
    reimbursement,
    postingStatus,
    companyId,
    userId,
    timestamp,
    today
  } = context;

  // A paid-out reimbursement cannot be voided. Without this the void wrote a
  // second journal crediting the employee payable again, leaving that account
  // negative with nothing that will ever clear it, the cash already gone, and a
  // live `invoiceSettlement` row pointing at a Voided document. `post-memo`
  // refuses the same shape ("Cannot void a consumed memo"); this is its
  // counterpart, and the only reason it was missing is that reimbursements got
  // their payout path after the void path was written.
  const settlement = await trx
    .selectFrom("invoiceSettlement as s")
    .leftJoin("payment as applying", "applying.id", "s.paymentId")
    .select("s.id")
    .where("s.companyId", "=", companyId)
    .where("s.targetReimbursementId", "=", reimbursement.id)
    .where((eb) =>
      eb.or([
        eb("s.paymentId", "is", null),
        eb("applying.status", "=", "Posted")
      ])
    )
    .limit(1)
    .executeTakeFirst();
  if (settlement) {
    throw new Error("Cannot void a paid reimbursement; void its payment first");
  }

  if (reimbursement.journalId) {
    const originalJournal = await trx
      .selectFrom("journal")
      .select(["id", "status", "sourceType"])
      .where("id", "=", reimbursement.journalId)
      .where("companyId", "=", companyId)
      .forShare()
      .executeTakeFirst();
    if (
      !originalJournal ||
      !(OPEN_ITEM_JOURNAL_STATUSES as readonly string[]).includes(
        originalJournal.status
      ) ||
      originalJournal.sourceType !== "Reimbursement"
    ) {
      throw new Error("Original reimbursement journal has invalid provenance");
    }
    const originalLines = await trx
      .selectFrom("journalLine")
      .innerJoin("journal", (join) =>
        join
          .onRef("journal.id", "=", "journalLine.journalId")
          .onRef("journal.companyId", "=", "journalLine.companyId")
      )
      .selectAll("journalLine")
      .where("journalLine.journalId", "=", originalJournal.id)
      .where("journalLine.companyId", "=", companyId)
      .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
      .orderBy("journalLine.id")
      .execute();
    if (
      !originalLines.length ||
      originalLines.some(
        (line) =>
          line.documentType !== "Reimbursement" ||
          line.documentId !== reimbursement.id
      )
    ) {
      throw new Error("Original reimbursement journal has invalid lines");
    }
    // A Provisional journal has no accounting period, and no posting creates a
    // period before the cutover.
    const period =
      postingStatus === "Posted"
        ? await resolveAccountingPeriod(trx, companyId, today, "current")
        : null;
    const reversal = await trx
      .insertInto("journal")
      .values({
        journalEntryId: await getNextSequence(trx, "journalEntry", companyId),
        accountingPeriodId: period?.id ?? null,
        description: `VOID Reimbursement ${reimbursement.reimbursementId}`,
        postingDate: period?.postingDate ?? today,
        companyId,
        sourceType: "Reimbursement",
        status: postingStatus,
        postedAt: timestamp,
        postedBy: userId,
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const reversalLineIds = await allocateJournalLineIds(
      trx,
      originalLines.length
    );
    await trx
      .insertInto("journalLine")
      .values(
        originalLines.map((line, index) => ({
          id: reversalLineIds[index],
          journalId: reversal.id,
          accountId: line.accountId,
          amount: -Number(line.amount),
          quantity: line.quantity,
          description: `VOID: ${line.description ?? ""}`,
          documentType: "Reimbursement" as const,
          documentId: reimbursement.id,
          documentLineReference: line.documentLineReference,
          journalLineReference: line.journalLineReference,
          accountDefaultRole: line.accountDefaultRole,
          companyId
        }))
      )
      .execute();
    const dimensions = await trx
      .selectFrom("journalLineDimension")
      .select(["journalLineId", "dimensionId", "valueId"])
      .where("companyId", "=", companyId)
      .where(
        "journalLineId",
        "in",
        originalLines.map((line) => line.id)
      )
      .execute();
    const reversalByOriginal = new Map(
      originalLines.map((line, index) => [line.id, reversalLineIds[index]])
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
          companyId
        };
      });
      await trx
        .insertInto("journalLineDimension")
        .values(reversedDimensions)
        .execute();
    }
  }

  await trx
    .updateTable("reimbursement")
    .set({
      status: "Voided",
      voidedAt: timestamp,
      voidedBy: userId,
      updatedAt: timestamp,
      updatedBy: userId
    })
    .where("id", "=", reimbursement.id)
    .where("companyId", "=", companyId)
    .execute();
  return { journalId: reimbursement.journalId };
}
