// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { OPEN_ITEM_JOURNAL_STATUSES } from "@carbon/database/accounting-posting";
import { getNextSequence } from "@carbon/database/sequence";
import {
  CHARGE_VOID_BEFORE_CUTOVER_ERROR,
  refuseVoidBeforeCutover
} from "../lib/cutover-void";
import { resolveAccountingPeriod } from "../lib/get-accounting-period";
import { allocateJournalLineIds } from "./journal-line-ids";
import type { ChargeContext } from "./post-charge-post";

export async function voidCharge(
  context: ChargeContext
): Promise<{ journalId: string | null }> {
  const { trx, charge, postingStatus, companyId, userId, timestamp, today } =
    context;

  // The enable superseded the journal of a charge dated before the cutover
  // and opened its balances in the opening journal, so a reversal of its own
  // lines would undo nothing. The date is the one the posting used.
  await refuseVoidBeforeCutover(
    trx,
    companyId,
    charge.postingDate ?? charge.transactionDate,
    CHARGE_VOID_BEFORE_CUTOVER_ERROR
  );

  if (charge.journalId) {
    const originalJournal = await trx
      .selectFrom("journal")
      .select(["id", "status", "sourceType"])
      .where("id", "=", charge.journalId)
      .where("companyId", "=", companyId)
      .forShare()
      .executeTakeFirst();
    if (
      !originalJournal ||
      !(OPEN_ITEM_JOURNAL_STATUSES as readonly string[]).includes(
        originalJournal.status
      ) ||
      originalJournal.sourceType !== "Charge"
    ) {
      throw new Error("Original charge journal has invalid provenance");
    }
    const originalLines = await trx
      .selectFrom("journalLine")
      .selectAll()
      // The journal's status was checked above, under FOR SHARE.
      .where("journalId", "=", originalJournal.id)
      .where("companyId", "=", companyId)
      .orderBy("id")
      .execute();
    if (
      !originalLines.length ||
      originalLines.some(
        (line) =>
          line.documentType !== "Charge" || line.documentId !== charge.id
      )
    ) {
      throw new Error("Original charge journal has invalid lines");
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
        description: `VOID Charge ${charge.chargeId}`,
        postingDate: period?.postingDate ?? today,
        companyId,
        sourceType: "Charge",
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
          documentType: "Charge" as const,
          documentId: charge.id,
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
    .updateTable("charge")
    .set({
      status: "Voided",
      voidedAt: timestamp,
      voidedBy: userId,
      updatedAt: timestamp,
      updatedBy: userId
    })
    .where("id", "=", charge.id)
    .where("companyId", "=", companyId)
    .execute();
  return { journalId: charge.journalId };
}
