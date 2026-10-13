// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { OPEN_ITEM_JOURNAL_STATUSES } from "@carbon/database/accounting-posting";
import {
  CHARGE_VOID_BEFORE_CUTOVER_ERROR,
  refuseVoidBeforeCutover
} from "../lib/cutover-void";
import { insertNegatedJournal } from "../lib/void-journal";
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
    await insertNegatedJournal(trx, {
      companyId,
      userId,
      originalLines,
      description: `VOID Charge ${charge.chargeId}`,
      sourceType: "Charge",
      postingStatus,
      date: today,
      periodMode: "current",
      postedAt: timestamp
    });
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
