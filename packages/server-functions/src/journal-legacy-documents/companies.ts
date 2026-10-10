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
import { getLogger } from "@carbon/logger";
import { sql } from "kysely";
import type { LegacyJournalCounts } from "../activate-accounting/legacy";
import { ServerFnContext } from "../server-fn-context";
import journalLegacyDocumentsFn from ".";

const logger = getLogger("server-functions", "journal-legacy-documents");

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
  db: Kysely<KyselyDatabase>,
  /** Only these companies; every company when omitted. */
  companyIds?: string[]
): Promise<LegacyRepairCompany[]> {
  let query = db
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
    .orderBy("settings.id");
  if (companyIds) query = query.where("settings.id", "in", companyIds);
  const companies = companyIds?.length === 0 ? [] : await query.execute();

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
  /** The company's own data refused the repair (a closed period, an empty
   *  account default, no user): reported for someone to fix in Settings →
   *  Accounting, and the run goes on. */
  | { companyId: string; status: "skipped"; reason: string }
  /** Anything else: a server failure, a bug, a lost connection. The script
   *  exits non-zero, so the next deploy retries. */
  | { companyId: string; status: "failed"; error: string };

/**
 * How a company whose repair returned `error` is reported. Only a refusal
 * (`status` below 500: bad input, a missing record, a missing account
 * default) is the company's data, and skipped. Everything else is `failed`:
 * skipping it would let the ledger row stop every retry.
 */
export function classifyRepairFailure(
  companyId: string,
  error: { status: number; message: string }
): Extract<LegacyRepairOutcome, { status: "skipped" | "failed" }> {
  return error.status < 500
    ? { companyId, status: "skipped", reason: error.message }
    : {
        companyId,
        status: "failed",
        error: error.message || "The server failed with no message."
      };
}

/**
 * Runs `journal-legacy-documents` for each company with work, one company per
 * transaction (the function's own), as the company's user. A company whose
 * data refuses the repair is skipped and reported, and the run goes on: a
 * deploy must not fail, and retry on every later deploy, over one company's
 * closed period. Any other failure is `failed`, and the run goes on to the
 * next company. With `dryRun` it only reports what it found.
 */
export async function journalLegacyDocumentsForAllCompanies(
  db: Kysely<KyselyDatabase>,
  {
    dryRun,
    companyIds,
    onOutcome
  }: {
    dryRun: boolean;
    /** Only these companies; every company when omitted. */
    companyIds?: string[];
    onOutcome?: (outcome: LegacyRepairOutcome) => void;
  }
): Promise<LegacyRepairOutcome[]> {
  const companies = await findCompaniesWithLegacyDocuments(db, companyIds);
  const outcomes: LegacyRepairOutcome[] = [];
  for (const { companyId, userId, counts } of companies) {
    let outcome: LegacyRepairOutcome;
    if (dryRun) {
      outcome = { companyId, status: "found", counts };
    } else if (!userId) {
      outcome = {
        companyId,
        status: "skipped",
        reason: "The company has no user who set up accounting and no Admin."
      };
    } else {
      const result = await journalLegacyDocumentsFn(
        ServerFnContext.system({ db, companyId, userId }),
        {}
      );
      outcome = result.error
        ? classifyRepairFailure(companyId, result.error)
        : {
            companyId,
            status: "written",
            journals: result.data.legacyJournals
          };
    }
    if (outcome.status === "failed") {
      logger.error("The legacy journal repair failed", { ...outcome });
    } else if (outcome.status === "skipped") {
      logger.warn("Skipped the legacy journal repair", { ...outcome });
    } else {
      logger.info("Legacy journal repair", { ...outcome });
    }
    onOutcome?.(outcome);
    outcomes.push(outcome);
  }
  return outcomes;
}
