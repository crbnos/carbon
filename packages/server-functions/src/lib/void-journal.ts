// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import type { AutomaticJournalStatus } from "@carbon/database/journal-posting-status";
import { getNextSequence } from "@carbon/database/sequence";
import type { Selectable, Transaction } from "kysely";
import { resolveAccountingPeriod } from "./get-accounting-period";
import { allocateJournalLineIds } from "./journal-line-ids";

type JournalLine = Selectable<KyselyDatabase["journalLine"]>;

/**
 * Voids a journal with a negated copy: a new journal dated `date` (in the
 * period `periodMode` resolves for it once the company has a cutover; a
 * Provisional journal has none), each original line negated with its
 * documents, account default role and dimensions. The caller checks the
 * original's provenance and passes its lines. Returns the copy's id.
 *
 * Used by the charge, reimbursement and lease voids.
 */
export async function insertNegatedJournal(
  trx: Transaction<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    originalLines: JournalLine[];
    description: string;
    sourceType: Database["public"]["Enums"]["journalEntrySourceType"];
    postingStatus: AutomaticJournalStatus;
    date: string;
    periodMode: "current" | "historical-with-shift";
    postedAt: string;
  }
): Promise<string> {
  const { companyId, userId, originalLines } = args;
  const period =
    args.postingStatus === "Posted"
      ? await resolveAccountingPeriod(
          trx,
          companyId,
          args.date,
          args.periodMode
        )
      : null;
  const reversal = await trx
    .insertInto("journal")
    .values({
      journalEntryId: await getNextSequence(trx, "journalEntry", companyId),
      accountingPeriodId: period?.id ?? null,
      description: args.description,
      postingDate: period?.postingDate ?? args.date,
      companyId,
      sourceType: args.sourceType,
      status: args.postingStatus,
      postedAt: args.postedAt,
      postedBy: userId,
      createdBy: userId
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  if (originalLines.length === 0) return reversal.id;

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
        documentType: line.documentType,
        documentId: line.documentId,
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
  if (dimensions.length > 0) {
    const reversalByOriginal = new Map(
      originalLines.map((line, index) => [line.id, reversalLineIds[index]])
    );
    await trx
      .insertInto("journalLineDimension")
      .values(
        dimensions.map((dimension) => {
          const journalLineId = reversalByOriginal.get(dimension.journalLineId);
          if (!journalLineId) {
            throw new Error("Failed to map a reversed journal line");
          }
          return { ...dimension, journalLineId, companyId };
        })
      )
      .execute();
  }
  return reversal.id;
}
