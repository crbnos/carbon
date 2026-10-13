// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The accounting enable (.ai/specs/implemented/2026-10-08-accounting-cutover.md section
// 5). One transaction: it writes the journals of legacy documents dated on
// or after the cutover (section 5a), resets inventory as of the cutover date, re-costs
// the outbound movements after it, supersedes the Provisional journals before
// it, posts the opening journal, promotes the Provisional journals on or after
// it, closes the periods before it and stamps the cutover. It holds
// `companySettings` FOR UPDATE throughout; every posting reads that row FOR
// SHARE, so no posting can write a Provisional journal after the commit.

import {
  buildOpeningJournalLines,
  isMigrationClearingZero
} from "@carbon/database/accounting-cutover";
import {
  ACCOUNTING_ALREADY_SET_UP,
  dayBeforeCutover,
  getActivationReadiness,
  getCutoverInventory,
  getMigrationClearing
} from "@carbon/database/accounting-cutover-reads";
import { missingDefaultMessage } from "@carbon/database/journal-posting-status";
import { getNextSequence } from "@carbon/database/sequence";
import { getLogger } from "@carbon/logger";
import { chunkArray, datetime } from "@carbon/utils";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import {
  getCurrentAccountingPeriod,
  resolveAccountingPeriod
} from "../lib/get-accounting-period";
import { journalLegacyDocuments, type LegacyJournalCounts } from "./legacy";
import { ROWS_PER_STATEMENT } from "./legacy/write";
import { assignPeriods, promoteJournals, repointStandInLines } from "./promote";
import { resetAndRecostInventory } from "./recost";

const logger = getLogger("server-functions", "activate-accounting");

export const activateAccountingInput = z.object({
  cutoverDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date"),
  confirmation: z.string()
});

export type ActivateAccountingResult = {
  cutoverDate: string;
  /** Null when nothing was open and the trial balance was empty. */
  openingJournalId: string | null;
  /** Legacy documents dated on or after the cutover that got their journal. */
  legacyJournals: LegacyJournalCounts;
};

const OPENING_JOURNAL_DESCRIPTION = "Opening Balance";

const activateAccounting = defineServerFn({
  name: "activate-accounting",
  input: activateAccountingInput,
  permissions: { update: "accounting" },
  async run(
    { db, companyId, userId },
    { cutoverDate, confirmation }
  ): Promise<ActivateAccountingResult> {
    return db
      .transaction()
      .execute(async (trx): Promise<ActivateAccountingResult> => {
        const refuse = (reason: string): never => {
          logger.warn("Refused the accounting enable", {
            companyId,
            cutoverDate,
            reason
          });
          throw new InvalidInputError(reason);
        };
        const now = datetime.timestamp();

        // Spec section 5, step 1. Lock the cutover stamp. Every posting reads
        // it FOR SHARE.
        const settings = await trx
          .selectFrom("companySettings")
          .select("accountingCutoverDate")
          .where("id", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        if (!settings) throw new NotFoundError("Company settings not found");
        if (settings.accountingCutoverDate) refuse(ACCOUNTING_ALREADY_SET_UP);

        // Step 1, continued. The typed company name.
        const company = await trx
          .selectFrom("company")
          .select(["name", "companyGroupId"])
          .where("id", "=", companyId)
          .executeTakeFirst();
        if (!company?.companyGroupId) {
          throw new NotFoundError("Company not found");
        }
        const companyGroupId = company.companyGroupId;
        if (confirmation.trim() !== company.name.trim()) {
          refuse("Type the company name to confirm.");
        }

        // Step 1, continued. Every readiness check and Migration Clearing,
        // under the lock.
        // These read the Provisional ledger, so they run before any write.
        const args = { companyId, cutoverDate };
        const readiness = await getActivationReadiness(trx, args);
        const failed = readiness.checks.find((check) => !check.passed);
        if (failed) refuse(failed.detail ?? failed.label);
        const clearing = await getMigrationClearing(trx, args);
        if (!isMigrationClearingZero(clearing.total)) {
          refuse(
            `Migration Clearing totals ${clearing.total}. It must be zero to set up accounting.`
          );
        }
        const migrationClearing =
          clearing.migrationClearingAccount ??
          refuse(missingDefaultMessage("migrationClearingAccount"));
        const defaults = await trx
          .selectFrom("accountDefault")
          .selectAll()
          .where("companyId", "=", companyId)
          .executeTakeFirstOrThrow();

        // Step 1a. The journals of legacy documents dated on or
        // after the cutover, Provisional, so the steps below treat them like
        // every other Provisional journal.
        const legacy = await journalLegacyDocuments(trx, {
          companyId,
          companyGroupId,
          userId,
          cutoverDate,
          defaults
        });

        // Steps 2 and 3. Inventory as of the cutover, and the movements after
        // it.
        await resetAndRecostInventory(trx, {
          companyId,
          userId,
          cutoverDate,
          companyGroupId,
          inventory: await getCutoverInventory(trx, args),
          defaults
        });

        // Step 4. Journals before the cutover leave the ledger for good.
        await trx
          .updateTable("journal")
          .set({ status: "Superseded", updatedBy: userId, updatedAt: now })
          .where("companyId", "=", companyId)
          .where("status", "=", "Provisional")
          .where("postingDate", "<", cutoverDate)
          .execute();

        // Step 5. Recognition and lease interest due before the cutover is in
        // the opening balance; no run posts it. Step 6 (fixed assets) writes
        // nothing: the register already holds the values at the cutover.
        await trx
          .updateTable("revenueRecognitionSchedule")
          .set({
            status: "Posted",
            journalId: null,
            updatedBy: userId,
            updatedAt: now
          })
          .where("companyId", "=", companyId)
          .where("status", "=", "Planned")
          .where("scheduledDate", "<", cutoverDate)
          .execute();

        // Step 7. The opening journal, the day before the cutover. It replaces
        // the Draft trial balance the wizard kept.
        const openingDate = dayBeforeCutover(cutoverDate);
        const draftTrialBalances = trx
          .selectFrom("journal")
          .select("id")
          .where("companyId", "=", companyId)
          .where("status", "=", "Draft")
          .where("sourceType", "=", "Opening Balance");
        await trx
          .deleteFrom("journalLine")
          .where("companyId", "=", companyId)
          .where("journalId", "in", draftTrialBalances)
          .execute();
        await trx
          .deleteFrom("journal")
          .where("companyId", "=", companyId)
          .where("status", "=", "Draft")
          .where("sourceType", "=", "Opening Balance")
          .execute();

        const openingLines = buildOpeningJournalLines(
          clearing.items,
          clearing.trialBalance,
          clearing.controlAccountIds,
          migrationClearing
        );
        // A company with nothing open and no trial balance opens with no
        // journal at all, rather than an empty one.
        let openingJournalId: string | null = null;
        if (openingLines.length > 0) {
          const openingPeriod = await resolveAccountingPeriod(
            trx,
            companyId,
            openingDate,
            "historical"
          );
          const openingJournal = await trx
            .insertInto("journal")
            .values({
              journalEntryId: await getNextSequence(
                trx,
                "journalEntry",
                companyId
              ),
              accountingPeriodId: openingPeriod.id,
              description: OPENING_JOURNAL_DESCRIPTION,
              postingDate: openingDate,
              sourceType: "Opening Balance",
              status: "Posted",
              postedAt: now,
              postedBy: userId,
              companyId,
              createdBy: userId
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          openingJournalId = openingJournal.id;
          for (const rows of chunkArray(openingLines, ROWS_PER_STATEMENT)) {
            await trx
              .insertInto("journalLine")
              .values(
                rows.map((line) => ({
                  journalId: openingJournal.id,
                  accountId: line.accountId,
                  amount: line.amount,
                  description: line.description,
                  documentType: line.documentType,
                  documentId: line.documentId,
                  documentLineReference: line.documentLineReference,
                  quantity: line.quantity ?? 0,
                  accrual: line.accrual ?? false,
                  journalLineReference: nanoid(),
                  companyId,
                  createdBy: userId
                }))
              )
              .execute();
          }
        }

        // Step 8. Periods for the journals that stay. A Superseded journal keeps
        // none.
        const staying = { cutoverDate };
        await assignPeriods(trx, companyId, staying);

        // Step 9. Stand-in lines written while a default was empty.
        await repointStandInLines(trx, companyId, staying, defaults);

        // Step 9, continued. Promote.
        await promoteJournals(trx, companyId, userId, staying);

        // Step 10. Close every period before the cutover, oldest first. Not
        // closeAccountingPeriod: it opens its own transaction.
        const periodsToClose = await trx
          .selectFrom("accountingPeriod")
          .select("id")
          .where("companyId", "=", companyId)
          .where("endDate", "<", cutoverDate)
          .where("closeStatus", "!=", "Closed")
          .orderBy("startDate")
          .execute();
        if (periodsToClose.length > 0) {
          await trx
            .updateTable("accountingPeriod")
            .set({
              closeStatus: "Closed",
              closedAt: now,
              closedBy: userId,
              updatedBy: userId,
              updatedAt: now
            })
            .where("companyId", "=", companyId)
            .where(
              "id",
              "in",
              periodsToClose.map((period) => period.id)
            )
            .execute();
          // The snapshot takes one period; the periods are few (at most
          // three before the current one, plus the opening journal's).
          for (const period of periodsToClose) {
            await sql`SELECT "snapshotAccountingPeriodBalances"(${companyId}, ${period.id}, ${userId})`.execute(
              trx
            );
          }
        }

        // Step 10a. Make the period that holds today Active, as the first
        // posting would. The cutover is never after today, so step 10 never
        // closes it.
        await getCurrentAccountingPeriod(companyId, trx);

        // Step 11. The stamp. One-way: a trigger refuses any later change.
        await trx
          .updateTable("companySettings")
          .set({
            accountingCutoverDate: cutoverDate,
            accountingActivatedAt: now,
            accountingActivatedBy: userId
          })
          .where("id", "=", companyId)
          .execute();

        logger.info("Set up accounting", {
          companyId,
          cutoverDate,
          openingJournalId,
          legacyJournals: legacy.counts
        });
        return { cutoverDate, openingJournalId, legacyJournals: legacy.counts };
      });
  }
});

export default activateAccounting;
