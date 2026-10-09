// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The companies `journal-legacy-documents` has work in, and the run over all
// of them, for the one-off script that repairs every company with nobody
// clicking (scripts/one-off/journal-legacy-documents.ts). A demo-template
// company never ran an enable: migration 20261009004448 backfilled its
// cutover, so a document posted in it with accounting off is legacy.

import { getLegacyDocumentCounts } from "@carbon/database/accounting-cutover-reads";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { LegacyDocumentCounts } from "@carbon/database/legacy-documents";
import { sql } from "kysely";
import type { LegacyJournalCounts } from "../activate-accounting/legacy";
import { ServerFnContext } from "../server-fn-context";
import journalLegacyDocuments from ".";

export type LegacyRepairCompany = {
  companyId: string;
  cutoverDate: string;
  /** The user the journals are recorded against: the one who set up
   *  accounting, else an active Admin employee. Null when there is neither. */
  userId: string | null;
  counts: LegacyDocumentCounts;
};

const total = (counts: LegacyDocumentCounts) =>
  Object.values(counts).reduce((sum, count) => sum + count, 0);

/**
 * Every company with an accounting cutover and a legacy document still
 * without a journal. One query reads the companies and their users; the
 * detection (`getLegacyDocumentCounts`, one statement) then runs per
 * company, because it is defined per company and cutover.
 */
export async function findCompaniesWithLegacyDocuments(
  db: Kysely<KyselyDatabase>
): Promise<LegacyRepairCompany[]> {
  const companies = await db
    .selectFrom("companySettings as settings")
    .innerJoin("company", "company.id", "settings.id")
    .select([
      "settings.id as companyId",
      sql<string>`"settings"."accountingCutoverDate"::text`.as("cutoverDate"),
      sql<string | null>`coalesce(
        "settings"."accountingActivatedBy",
        (
          SELECT "employee"."id"
          FROM "employee"
          INNER JOIN "employeeType"
            ON "employeeType"."id" = "employee"."employeeTypeId"
            AND "employeeType"."companyId" = "employee"."companyId"
          WHERE "employee"."companyId" = "settings"."id"
            AND "employee"."active" = true
            AND "employeeType"."systemType" = 'Admin'
          ORDER BY "employee"."id"
          LIMIT 1
        )
      )`.as("userId")
    ])
    .where("settings.accountingCutoverDate", "is not", null)
    .orderBy("settings.id")
    .execute();

  const withWork: LegacyRepairCompany[] = [];
  for (const company of companies) {
    const counts = await getLegacyDocumentCounts(db, company);
    if (total(counts) > 0) withWork.push({ ...company, counts });
  }
  return withWork;
}

export type LegacyRepairOutcome =
  | { companyId: string; status: "written"; journals: LegacyJournalCounts }
  | { companyId: string; status: "found"; counts: LegacyDocumentCounts }
  | { companyId: string; status: "failed"; error: string };

/**
 * Runs `journal-legacy-documents` for each company with work, one company per
 * transaction (the function's own), as the company's user. A company that
 * fails (a closed period, no user) is reported and the run goes on. With
 * `dryRun` it only reports what it found.
 */
export async function journalLegacyDocumentsForAllCompanies(
  db: Kysely<KyselyDatabase>,
  {
    dryRun,
    onOutcome
  }: { dryRun: boolean; onOutcome?: (outcome: LegacyRepairOutcome) => void }
): Promise<LegacyRepairOutcome[]> {
  const companies = await findCompaniesWithLegacyDocuments(db);
  const outcomes: LegacyRepairOutcome[] = [];
  for (const { companyId, userId, counts } of companies) {
    let outcome: LegacyRepairOutcome;
    if (dryRun) {
      outcome = { companyId, status: "found", counts };
    } else if (!userId) {
      outcome = {
        companyId,
        status: "failed",
        error: "The company has no user who set up accounting and no Admin."
      };
    } else {
      const result = await journalLegacyDocuments(
        ServerFnContext.system({ db, companyId, userId }),
        {}
      );
      outcome = result.error
        ? {
            companyId,
            status: "failed",
            error: result.error.message || "The data layer refused a write."
          }
        : {
            companyId,
            status: "written",
            journals: result.data.legacyJournals
          };
    }
    onOutcome?.(outcome);
    outcomes.push(outcome);
  }
  return outcomes;
}
