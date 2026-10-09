// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Voids of documents dated before the company's accounting cutover
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 6). The enable
// superseded their journals and reset the cost layers they moved, so a
// reversal of their own lines would undo nothing the opening journal opened.

import { isBeforeCutover } from "@carbon/database/accounting-cutover-dates";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { readAccountingCutoverDate } from "@carbon/database/journal-posting-status";
import { InvalidInputError } from "../errors";

export const INVENTORY_VOID_BEFORE_CUTOVER_ERROR =
  "This document is from before your accounting cutover. Record a return or an inventory adjustment instead.";
export const SALES_INVOICE_VOID_BEFORE_CUTOVER_ERROR =
  "This invoice is from before your accounting cutover. Issue a credit memo instead.";
export const PURCHASE_INVOICE_VOID_BEFORE_CUTOVER_ERROR =
  "This invoice is from before your accounting cutover. Record a debit memo instead.";
export const CHARGE_VOID_BEFORE_CUTOVER_ERROR =
  "This charge is from before your accounting cutover. Record a journal entry to correct it instead.";
export const REIMBURSEMENT_VOID_BEFORE_CUTOVER_ERROR =
  "This reimbursement is from before your accounting cutover. Record a journal entry to correct it instead.";
export const TIME_ENTRY_BEFORE_CUTOVER_ERROR =
  "This time entry was posted before your accounting cutover. Record a journal entry to correct it instead.";

/**
 * Throws `message` when the document's posting date is before the company's
 * cutover. Call it before any write. A company with no cutover, or a document
 * with no posting date, passes.
 */
export async function refuseVoidBeforeCutover(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  postingDate: string | null | undefined,
  message: string
): Promise<void> {
  if (!postingDate) return;
  const cutoverDate = await readAccountingCutoverDate(db, companyId);
  if (isBeforeCutover(postingDate, cutoverDate)) {
    throw new InvalidInputError(message);
  }
}

/**
 * Refuses a rebuilt void line on Migration Clearing. Only the opening journal
 * and the trial balance post there; a void that did would move the proof
 * that the opening ties out.
 */
export function assertNoMigrationClearing(
  lines: { accountId: string | null }[],
  migrationClearingAccountId: string | null
): void {
  if (
    migrationClearingAccountId &&
    lines.some((line) => line.accountId === migrationClearingAccountId)
  ) {
    throw new Error("A void never posts to the Migration Clearing account.");
  }
}
